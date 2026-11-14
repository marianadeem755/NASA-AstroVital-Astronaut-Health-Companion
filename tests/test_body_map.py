from datetime import UTC, datetime, timedelta

import pytest


@pytest.fixture()
def astronaut_id(client):
    return client.post("/api/v1/astronauts", json={"crew_code": "AV-1", "full_name": "T"}).json()["id"]


def days_ago(n: float) -> str:
    return (datetime.now(UTC) - timedelta(days=n)).isoformat()


def report(client, astronaut_id, expect=201, **overrides):
    payload = {
        "astronaut_id": astronaut_id, "region_code": "head", "symptom_type": "headache",
        "severity": 5, **overrides,
    }
    r = client.post("/api/v1/body-map/symptoms", json=payload)
    assert r.status_code == expect, r.text
    return r.json()


def test_regions_are_listed_including_required_ones(client):
    codes = {r["code"] for r in client.get("/api/v1/body-map/regions").json()}
    assert {"head", "face", "neck", "upper_back", "lower_back", "chest", "abdomen", "legs"} <= codes


def test_report_symptom_normalises_text_and_defaults_time(client, astronaut_id):
    body = report(client, astronaut_id, region_code=" Lower Back ", symptom_type="Back Pain", duration_minutes=90)
    assert body["region_code"] == "lower_back" and body["region_name"] == "Lower back"
    assert body["symptom_type"] == "back_pain" and body["duration_minutes"] == 90
    assert body["reported_at"]  # defaulted to now


@pytest.mark.parametrize(
    "bad",
    [
        {"severity": 0},
        {"severity": 11},
        {"symptom_type": ""},
        {"duration_minutes": -5},
        {"reported_at": "2999-01-01T00:00:00Z"},
        {"notes": "x" * 1001},
    ],
)
def test_invalid_symptom_returns_422(client, astronaut_id, bad):
    report(client, astronaut_id, expect=422, **bad)


def test_unknown_region_returns_422_listing_valid_regions(client, astronaut_id):
    r = client.post(
        "/api/v1/body-map/symptoms",
        json={"astronaut_id": astronaut_id, "region_code": "elbow", "symptom_type": "pain", "severity": 3},
    )
    assert r.status_code == 422 and "lower_back" in r.json()["detail"]


def test_unknown_astronaut_returns_404(client):
    report(client, 999, expect=404)


def test_duplicate_client_uuid_is_idempotent(client, astronaut_id):
    first = report(client, astronaut_id, client_uuid="sym-uuid-0001")
    second = report(client, astronaut_id, expect=200, client_uuid="sym-uuid-0001")
    assert first["id"] == second["id"]
    assert client.get(f"/api/v1/body-map/{astronaut_id}").json()["total"] == 1


def test_history_filters_and_orders_newest_first(client, astronaut_id):
    report(client, astronaut_id, reported_at=days_ago(3), region_code="head", severity=2)
    report(client, astronaut_id, reported_at=days_ago(1), region_code="head", severity=4)
    report(client, astronaut_id, reported_at=days_ago(2), region_code="legs", symptom_type="cramp", severity=6)

    everything = client.get(f"/api/v1/body-map/{astronaut_id}").json()
    assert everything["total"] == 3
    assert [i["severity"] for i in everything["items"]] == [4, 6, 2]

    head = client.get(f"/api/v1/body-map/{astronaut_id}?region=head").json()
    assert head["total"] == 2 and all(i["region_code"] == "head" for i in head["items"])
    assert client.get(f"/api/v1/body-map/{astronaut_id}?symptom_type=Cramp").json()["total"] == 1
    assert client.get(f"/api/v1/body-map/{astronaut_id}?limit=1").json()["items"].__len__() == 1
    assert client.get(f"/api/v1/body-map/{astronaut_id}?region=elbow").status_code == 422
    assert client.get("/api/v1/body-map/999").status_code == 404


def test_trend_worsening(client, astronaut_id):
    for d, sev in [(25, 3), (24, 3), (3, 7), (2, 8)]:
        report(client, astronaut_id, reported_at=days_ago(d), severity=sev)
    t = client.get(f"/api/v1/body-map/{astronaut_id}/trends?days=30").json()
    head = t["regions"][0]
    assert head["trend"] == "worsening"
    assert head["count"] == 4 and head["max_severity"] == 8 and head["latest_severity"] == 8
    assert head["mean_severity"] == 5.25
    assert len(head["daily"]) == 4 and head["symptom_types"] == {"headache": 4}
    assert t["total_reports"] == 4 and "not a diagnosis" in t["method_note"]


def test_trend_improving_and_stable(client, astronaut_id):
    for d, sev in [(25, 8), (24, 7), (3, 3), (2, 2)]:
        report(client, astronaut_id, reported_at=days_ago(d), severity=sev, region_code="neck", symptom_type="stiffness")
    for d, sev in [(25, 5), (20, 5), (5, 5), (2, 5)]:
        report(client, astronaut_id, reported_at=days_ago(d), severity=sev, region_code="chest", symptom_type="tightness")
    regions = {r["region_code"]: r for r in client.get(f"/api/v1/body-map/{astronaut_id}/trends").json()["regions"]}
    assert regions["neck"]["trend"] == "improving"
    assert regions["chest"]["trend"] == "stable"


def test_trend_needs_enough_data(client, astronaut_id):
    report(client, astronaut_id, reported_at=days_ago(20), severity=2)
    report(client, astronaut_id, reported_at=days_ago(1), severity=9)
    t = client.get(f"/api/v1/body-map/{astronaut_id}/trends").json()
    assert t["regions"][0]["trend"] == "insufficient_data"


def test_trends_respect_window_and_filters_and_order(client, astronaut_id):
    report(client, astronaut_id, reported_at=days_ago(60), severity=9)  # outside 30-day window
    report(client, astronaut_id, reported_at=days_ago(2), region_code="head", severity=3)
    report(client, astronaut_id, reported_at=days_ago(1), region_code="legs", symptom_type="cramp", severity=7)
    t = client.get(f"/api/v1/body-map/{astronaut_id}/trends?days=30").json()
    assert t["total_reports"] == 2
    assert [r["region_code"] for r in t["regions"]] == ["legs", "head"]  # highest latest severity first
    only = client.get(f"/api/v1/body-map/{astronaut_id}/trends?region=head").json()
    assert [r["region_code"] for r in only["regions"]] == ["head"]


def test_trends_validation(client, astronaut_id):
    assert client.get(f"/api/v1/body-map/{astronaut_id}/trends?days=0").status_code == 422
    assert client.get(f"/api/v1/body-map/{astronaut_id}/trends?region=elbow").status_code == 422
    assert client.get("/api/v1/body-map/999/trends").status_code == 404
    empty = client.get(f"/api/v1/body-map/{astronaut_id}/trends").json()
    assert empty["regions"] == [] and empty["total_reports"] == 0
