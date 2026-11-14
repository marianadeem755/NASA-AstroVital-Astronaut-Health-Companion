import pytest


@pytest.fixture()
def astronaut_id(client):
    r = client.post("/api/v1/astronauts", json={"crew_code": "AV-001", "full_name": "Test"})
    return r.json()["id"]


def obs(astronaut_id, **overrides):
    base = {
        "astronaut_id": astronaut_id,
        "observed_at": "2026-01-01T08:00:00Z",
        "heart_rate_bpm": 72,
        "sleep_hours": 6.5,
    }
    return {**base, **overrides}


def test_create_observation_tracks_missing_fields(client, astronaut_id):
    r = client.post("/api/v1/observations", json=obs(astronaut_id))
    assert r.status_code == 201
    body = r.json()
    assert body["heart_rate_bpm"] == 72
    assert "stress_level" in body["missing_fields"]
    assert "heart_rate_bpm" not in body["missing_fields"]
    assert body["quality_score"] == pytest.approx(2 / 9, abs=0.001)


def test_unknown_astronaut_returns_404(client):
    assert client.post("/api/v1/observations", json=obs(999)).status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"heart_rate_bpm": 5},                    # physiologically impossible
        {"fatigue_level": 11},                    # outside 0-10
        {"observed_at": "2999-01-01T00:00:00Z"},  # future timestamp
        {"observed_at": "not-a-date"},
    ],
)
def test_invalid_observation_returns_422(client, astronaut_id, bad):
    assert client.post("/api/v1/observations", json=obs(astronaut_id, **bad)).status_code == 422


def test_observation_without_any_metric_returns_422(client, astronaut_id):
    payload = {"astronaut_id": astronaut_id, "observed_at": "2026-01-01T08:00:00Z"}
    assert client.post("/api/v1/observations", json=payload).status_code == 422


def test_duplicate_client_uuid_is_idempotent(client, astronaut_id):
    payload = obs(astronaut_id, client_uuid="abc-12345-uuid")
    first = client.post("/api/v1/observations", json=payload)
    second = client.post("/api/v1/observations", json=payload)
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert client.get(f"/api/v1/observations/{astronaut_id}").json()["total"] == 1


def test_list_is_newest_first_and_filterable(client, astronaut_id):
    for day in ("01", "02", "03"):
        client.post("/api/v1/observations", json=obs(astronaut_id, observed_at=f"2026-01-{day}T08:00:00Z"))
    items = client.get(f"/api/v1/observations/{astronaut_id}").json()["items"]
    assert [i["observed_at"][:10] for i in items] == ["2026-01-03", "2026-01-02", "2026-01-01"]

    filtered = client.get(
        f"/api/v1/observations/{astronaut_id}", params={"start": "2026-01-02T00:00:00Z"}
    ).json()
    assert filtered["total"] == 2


def test_latest_observation(client, astronaut_id):
    assert client.get(f"/api/v1/observations/{astronaut_id}/latest").status_code == 404
    client.post("/api/v1/observations", json=obs(astronaut_id, observed_at="2026-01-01T08:00:00Z"))
    client.post("/api/v1/observations", json=obs(astronaut_id, observed_at="2026-02-01T08:00:00Z", heart_rate_bpm=80))
    latest = client.get(f"/api/v1/observations/{astronaut_id}/latest").json()
    assert latest["heart_rate_bpm"] == 80


def test_bulk_reports_created_duplicate_and_rejected(client, astronaut_id):
    batch = {
        "observations": [
            obs(astronaut_id, client_uuid="bulk-uuid-0001"),
            obs(astronaut_id, client_uuid="bulk-uuid-0001"),  # duplicate inside the batch
            obs(999, client_uuid="bulk-uuid-0002"),           # unknown astronaut
            obs(astronaut_id),
        ]
    }
    r = client.post("/api/v1/observations/bulk", json=batch)
    assert r.status_code == 200
    body = r.json()
    assert (body["created"], body["duplicates"], body["rejected"]) == (2, 1, 1)
    assert [x["status"] for x in body["results"]] == ["created", "duplicate", "rejected", "created"]
