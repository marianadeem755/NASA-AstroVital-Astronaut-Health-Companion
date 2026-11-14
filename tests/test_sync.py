"""Offline synchronisation: idempotency, duplicates, conflicts, isolation, resolution."""
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select

from app.models.body_map import SymptomReport
from app.models.observation import Observation
from app.models.sync import SyncEvent
from app.models.wellbeing import WellbeingAssessment

T0 = (datetime.now(UTC) - timedelta(hours=3)).replace(microsecond=0).isoformat()


@pytest.fixture()
def aid(client):
    return client.post("/api/v1/astronauts", json={"crew_code": "AV-1", "full_name": "T"}).json()["id"]


def obs_payload(aid, **kw):
    return {"astronaut_id": aid, "observed_at": T0, "heart_rate_bpm": 70, **kw}


def event(uuid, entity="observation", payload=None, **kw):
    return {"client_uuid": uuid, "entity_type": entity, "payload": payload, **kw}


def push(client, events, device="tablet-1", expect=200):
    r = client.post("/api/v1/sync/push", json={"device_id": device, "events": events})
    assert r.status_code == expect, r.text
    return r.json()


def count(db_session, model):
    db_session.expire_all()
    return db_session.scalar(select(func.count()).select_from(model))


# ---------- applying ----------

def test_push_applies_all_three_entity_types(client, aid, db_session):
    body = push(client, [
        event("obs-uuid-0001", payload=obs_payload(aid)),
        event("sym-uuid-0001", "symptom", {"astronaut_id": aid, "region_code": "Head", "symptom_type": "Headache",
                                            "severity": 5, "reported_at": T0}),
        event("wel-uuid-0001", "wellbeing", {"astronaut_id": aid, "sleep_quality": 6, "mood": 6, "stress": 3,
                                              "fatigue": 3, "cognitive": {"reaction_time_ms": 250}}),
    ])
    assert (body["received"], body["applied"], body["failed"]) == (3, 3, 0)
    assert all(r["entity_id"] for r in body["results"])
    assert count(db_session, Observation) == count(db_session, SymptomReport) == count(db_session, WellbeingAssessment) == 1
    assert client.get(f"/api/v1/observations/{aid}").json()["items"][0]["client_uuid"] == "obs-uuid-0001"


def test_event_client_uuid_overrides_uuid_inside_payload(client, aid):
    push(client, [event("event-uuid-01", payload=obs_payload(aid, client_uuid="something-else"))])
    assert client.get(f"/api/v1/observations/{aid}").json()["items"][0]["client_uuid"] == "event-uuid-01"


# ---------- idempotency / duplicates ----------

def test_replaying_a_batch_creates_no_duplicates(client, aid, db_session):
    batch = [event("obs-uuid-0001", payload=obs_payload(aid)),
             event("obs-uuid-0002", payload=obs_payload(aid, observed_at=(datetime.now(UTC) - timedelta(hours=2)).isoformat()))]
    first = push(client, batch)
    again = push(client, batch)
    assert first["applied"] == 2 and again["applied"] == 0 and again["duplicates"] == 2
    assert [r["status"] for r in again["results"]] == ["duplicate", "duplicate"]
    assert again["results"][0]["entity_id"] == first["results"][0]["entity_id"]
    assert count(db_session, Observation) == 2 and count(db_session, SyncEvent) == 2


def test_duplicate_inside_one_batch(client, aid, db_session):
    e = event("obs-uuid-0001", payload=obs_payload(aid))
    body = push(client, [e, e])
    assert [r["status"] for r in body["results"]] == ["applied", "duplicate"]
    assert count(db_session, Observation) == 1


def test_record_already_created_online_is_reported_duplicate(client, aid, db_session):
    client.post("/api/v1/observations", json=obs_payload(aid, client_uuid="obs-uuid-0001"))
    body = push(client, [event("obs-uuid-0001", payload=obs_payload(aid))])
    assert body["results"][0]["status"] == "duplicate" and count(db_session, Observation) == 1


def test_same_moment_same_values_different_uuid_is_duplicate_not_conflict(client, aid, db_session):
    client.post("/api/v1/observations", json=obs_payload(aid, client_uuid="online-uuid-01"))
    body = push(client, [event("other-uuid-001", payload=obs_payload(aid))])
    assert body["results"][0]["status"] == "duplicate"
    assert body["results"][0]["detail"] == "Identical record already stored"
    assert count(db_session, Observation) == 1


# ---------- conflicts ----------

def test_same_uuid_with_different_content_is_a_conflict_and_not_applied(client, aid, db_session):
    push(client, [event("obs-uuid-0001", payload=obs_payload(aid, heart_rate_bpm=70))])
    body = push(client, [event("obs-uuid-0001", payload=obs_payload(aid, heart_rate_bpm=99))])
    res = body["results"][0]
    assert res["status"] == "conflict" and res["conflict_id"]
    assert count(db_session, Observation) == 1
    stored = client.get(f"/api/v1/observations/{aid}").json()["items"][0]
    assert stored["heart_rate_bpm"] == 70  # server version untouched

    again = push(client, [event("obs-uuid-0001", payload=obs_payload(aid, heart_rate_bpm=99))])
    assert again["results"][0]["conflict_id"] == res["conflict_id"]  # no second conflict
    assert client.get("/api/v1/sync/status").json()["open_conflicts"] == 1


def test_timestamp_collision_with_different_values_is_a_conflict(client, aid, db_session):
    client.post("/api/v1/observations", json=obs_payload(aid, client_uuid="online-uuid-01", heart_rate_bpm=70))
    body = push(client, [event("device-uuid-01", payload=obs_payload(aid, heart_rate_bpm=95))])
    res = body["results"][0]
    assert res["status"] == "conflict"
    assert count(db_session, Observation) == 1  # nothing applied, nothing lost
    conflict = client.get("/api/v1/sync/status").json()["conflicts"][0]
    assert conflict["conflict_type"] == "timestamp_collision"
    assert conflict["server_snapshot"]["heart_rate_bpm"] == 70
    assert conflict["client_snapshot"]["heart_rate_bpm"] == 95  # the device's data is preserved

    replay = push(client, [event("device-uuid-01", payload=obs_payload(aid, heart_rate_bpm=95))])
    assert replay["results"][0]["status"] == "conflict" and replay["results"][0]["conflict_id"] == res["conflict_id"]


def test_symptom_and_wellbeing_collisions(client, aid):
    sym = {"astronaut_id": aid, "region_code": "head", "symptom_type": "headache", "severity": 3, "reported_at": T0}
    well = {"astronaut_id": aid, "assessed_at": T0, "sleep_quality": 6, "mood": 6, "stress": 3, "fatigue": 3}
    client.post("/api/v1/body-map/symptoms", json={**sym, "client_uuid": "sym-online-01"})
    client.post("/api/v1/wellbeing/assessment", json={**well, "client_uuid": "wel-online-01"})
    body = push(client, [
        event("sym-device-01", "symptom", {**sym, "severity": 8}),
        event("wel-device-01", "wellbeing", {**well, "stress": 9}),
    ])
    assert [r["status"] for r in body["results"]] == ["conflict", "conflict"]


# ---------- resolution ----------

def collision(client, aid):
    client.post("/api/v1/observations", json=obs_payload(aid, client_uuid="online-uuid-01", heart_rate_bpm=70))
    return push(client, [event("device-uuid-01", payload=obs_payload(aid, heart_rate_bpm=95))])["results"][0]


def test_accept_client_stores_the_device_version_as_an_extra_record(client, aid, db_session):
    cid = collision(client, aid)["conflict_id"]
    r = client.post(f"/api/v1/sync/conflicts/{cid}/resolve", json={"resolution": "accept_client"})
    assert r.status_code == 200 and r.json()["resolution"] == "accept_client" and r.json()["resolved_at"]
    assert count(db_session, Observation) == 2
    assert client.get("/api/v1/sync/status").json()["open_conflicts"] == 0
    assert push(client, [event("device-uuid-01", payload=obs_payload(aid, heart_rate_bpm=95))])["results"][0]["status"] == "duplicate"
    # idempotent
    assert client.post(f"/api/v1/sync/conflicts/{cid}/resolve", json={"resolution": "accept_client"}).status_code == 200
    assert count(db_session, Observation) == 2


def test_keep_server_discards_client_version_without_deleting_anything(client, aid, db_session):
    cid = collision(client, aid)["conflict_id"]
    assert client.post(f"/api/v1/sync/conflicts/{cid}/resolve", json={"resolution": "keep_server"}).status_code == 200
    assert count(db_session, Observation) == 1
    assert client.get("/api/v1/sync/status").json()["totals"]["discarded"] == 1
    assert push(client, [event("device-uuid-01", payload=obs_payload(aid, heart_rate_bpm=95))])["results"][0]["status"] == "duplicate"


def test_resolution_errors(client, aid):
    cid = collision(client, aid)["conflict_id"]
    assert client.post("/api/v1/sync/conflicts/999/resolve", json={"resolution": "keep_server"}).status_code == 404
    assert client.post(f"/api/v1/sync/conflicts/{cid}/resolve", json={"resolution": "merge"}).status_code == 422
    client.post(f"/api/v1/sync/conflicts/{cid}/resolve", json={"resolution": "keep_server"})
    assert client.post(f"/api/v1/sync/conflicts/{cid}/resolve", json={"resolution": "accept_client"}).status_code == 409


# ---------- failures and isolation ----------

def test_bad_events_fail_individually_without_affecting_the_batch(client, aid, db_session):
    body = push(client, [
        event("good-uuid-0001", payload=obs_payload(aid)),
        event("bad-uuid-00001", payload=obs_payload(aid, heart_rate_bpm=5)),                 # out of range
        event("ghost-uuid-001", payload=obs_payload(999)),                                    # unknown astronaut
        event("region-uuid-01", "symptom", {"astronaut_id": aid, "region_code": "elbow",
                                            "symptom_type": "pain", "severity": 3}),          # unknown region
        event("empty-uuid-001", payload={"astronaut_id": aid, "observed_at": T0}),            # no metrics
    ])
    assert [r["status"] for r in body["results"]] == ["applied", "failed", "failed", "failed", "failed"]
    assert "heart_rate_bpm" in body["results"][1]["detail"]
    assert body["results"][2]["detail"] == "Astronaut not found"
    assert "elbow" in body["results"][3]["detail"]
    assert count(db_session, Observation) == 1
    assert (body["applied"], body["failed"]) == (1, 4)


def test_failed_event_can_be_resubmitted_corrected_under_the_same_uuid(client, aid, db_session):
    assert push(client, [event("fix-uuid-00001", payload=obs_payload(aid, heart_rate_bpm=5))])["failed"] == 1
    fixed = push(client, [event("fix-uuid-00001", payload=obs_payload(aid, heart_rate_bpm=72))])
    assert fixed["results"][0]["status"] == "applied"
    assert count(db_session, Observation) == 1 and count(db_session, SyncEvent) == 1


# ---------- request validation ----------

@pytest.mark.parametrize(
    "body",
    [
        {"device_id": "d", "events": []},
        {"device_id": "", "events": [{"client_uuid": "abcdefgh1", "entity_type": "observation", "payload": {}}]},
        {"device_id": "d", "events": [{"client_uuid": "short", "entity_type": "observation", "payload": {}}]},
        {"device_id": "d", "events": [{"client_uuid": "abcdefgh1", "entity_type": "alert", "payload": {}}]},
        {"device_id": "d", "events": [{"client_uuid": "abcdefgh1", "entity_type": "observation"}]},
        {"events": [{"client_uuid": "abcdefgh1", "entity_type": "observation", "payload": {}}]},
    ],
)
def test_invalid_push_requests_return_422(client, body):
    assert client.post("/api/v1/sync/push", json=body).status_code == 422


def test_batch_size_is_capped(client, aid):
    events = [event(f"bulk-uuid-{i:05d}", payload=obs_payload(aid)) for i in range(201)]
    assert client.post("/api/v1/sync/push", json={"device_id": "d", "events": events}).status_code == 422


# ---------- status ----------

def test_status_reports_totals_per_device_and_last_processed(client, aid):
    empty = client.get("/api/v1/sync/status").json()
    assert empty["totals"] == {} and empty["last_processed_at"] is None and empty["open_conflicts"] == 0

    push(client, [event("a-uuid-000001", payload=obs_payload(aid))], device="tablet-1")
    push(client, [event("b-uuid-000001", payload=obs_payload(aid, heart_rate_bpm=5))], device="tablet-2")
    everything = client.get("/api/v1/sync/status").json()
    assert everything["totals"] == {"applied": 1, "failed": 1} and everything["last_processed_at"]
    assert client.get("/api/v1/sync/status?device_id=tablet-1").json()["totals"] == {"applied": 1}
    assert client.get("/api/v1/sync/status?device_id=tablet-2").json()["totals"] == {"failed": 1}
    assert client.get("/api/v1/sync/status?device_id=nobody").json()["totals"] == {}
