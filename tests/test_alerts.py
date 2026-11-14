from datetime import UTC, datetime, timedelta

import pytest


@pytest.fixture()
def astronaut_id(client):
    return client.post("/api/v1/astronauts", json={"crew_code": "AV-1", "full_name": "T"}).json()["id"]


def post_obs(client, astronaut_id, **metrics):
    when = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    r = client.post("/api/v1/observations", json={"astronaut_id": astronaut_id, "observed_at": when, **metrics})
    assert r.status_code == 201, r.text


@pytest.fixture()
def alerts_created(client, astronaut_id):
    """Risk analysis raises: sleep_fatigue (critical), psychological (high), combined (critical)."""
    post_obs(client, astronaut_id, sleep_hours=4, fatigue_level=8, stress_level=8)
    assert client.post(f"/api/v1/risk/analyze/{astronaut_id}").json()["alerts_created"] >= 2
    return astronaut_id


def test_no_alerts_initially(client, astronaut_id):
    body = client.get(f"/api/v1/alerts/{astronaut_id}").json()
    assert body["items"] == [] and body["total"] == 0
    assert body["open_by_priority"] == {"critical": 0, "high": 0, "medium": 0, "low": 0}


def test_risk_analysis_alerts_are_listed_with_counts(client, alerts_created):
    body = client.get(f"/api/v1/alerts/{alerts_created}").json()
    assert body["total"] == len(body["items"]) >= 2
    assert all(a["status"] == "open" and a["risk_assessment_id"] for a in body["items"])
    assert sum(body["open_by_priority"].values()) == body["total"]
    assert body["open_by_priority"]["critical"] >= 1


def test_filter_by_priority_and_status(client, alerts_created):
    critical = client.get(f"/api/v1/alerts/{alerts_created}?priority=critical").json()
    assert critical["total"] >= 1 and all(a["priority"] == "critical" for a in critical["items"])
    assert client.get(f"/api/v1/alerts/{alerts_created}?status=acknowledged").json()["total"] == 0
    assert client.get(f"/api/v1/alerts/{alerts_created}?limit=1").json()["items"].__len__() == 1


def test_invalid_filters_return_422(client, astronaut_id):
    assert client.get(f"/api/v1/alerts/{astronaut_id}?priority=urgent").status_code == 422
    assert client.get(f"/api/v1/alerts/{astronaut_id}?status=closed").status_code == 422
    assert client.get(f"/api/v1/alerts/{astronaut_id}?limit=0").status_code == 422


def test_list_unknown_astronaut_returns_404(client):
    assert client.get("/api/v1/alerts/999").status_code == 404


def test_acknowledge_alert(client, alerts_created):
    alert = client.get(f"/api/v1/alerts/{alerts_created}").json()["items"][0]
    r = client.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"acknowledged_by": "  Dr. Smith "})
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "acknowledged" and body["acknowledged_by"] == "Dr. Smith"
    assert body["acknowledged_at"]

    after = client.get(f"/api/v1/alerts/{alerts_created}").json()
    assert sum(after["open_by_priority"].values()) == after["total"] - 1
    assert client.get(f"/api/v1/alerts/{alerts_created}?status=acknowledged").json()["total"] == 1


def test_acknowledge_without_body_works(client, alerts_created):
    alert = client.get(f"/api/v1/alerts/{alerts_created}").json()["items"][0]
    r = client.post(f"/api/v1/alerts/{alert['id']}/acknowledge")
    assert r.status_code == 200 and r.json()["acknowledged_by"] is None


def test_second_acknowledge_keeps_original_audit_trail(client, alerts_created):
    alert = client.get(f"/api/v1/alerts/{alerts_created}").json()["items"][0]
    first = client.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"acknowledged_by": "Alice"}).json()
    second = client.post(f"/api/v1/alerts/{alert['id']}/acknowledge", json={"acknowledged_by": "Bob"}).json()
    assert second["acknowledged_by"] == "Alice"
    assert second["acknowledged_at"] == first["acknowledged_at"]


def test_acknowledge_unknown_alert_returns_404(client):
    assert client.post("/api/v1/alerts/999/acknowledge").status_code == 404


def test_new_alert_can_be_raised_after_previous_was_acknowledged(client, alerts_created):
    """Open-alert dedup only looks at OPEN alerts, so a persisting risk re-alerts once handled."""
    for a in client.get(f"/api/v1/alerts/{alerts_created}").json()["items"]:
        client.post(f"/api/v1/alerts/{a['id']}/acknowledge")
    again = client.post(f"/api/v1/risk/analyze/{alerts_created}").json()
    assert again["alerts_created"] >= 2
