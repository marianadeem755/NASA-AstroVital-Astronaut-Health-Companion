import pytest

PAYLOAD = {"crew_code": "AV-001", "full_name": "Test Astronaut", "height_cm": 175, "weight_kg": 70}


def test_create_and_get_astronaut(client):
    created = client.post("/api/v1/astronauts", json=PAYLOAD)
    assert created.status_code == 201
    body = created.json()
    assert body["crew_code"] == "AV-001" and body["is_active"] is True

    fetched = client.get(f"/api/v1/astronauts/{body['id']}")
    assert fetched.status_code == 200
    assert fetched.json()["full_name"] == "Test Astronaut"


def test_duplicate_crew_code_returns_409(client):
    client.post("/api/v1/astronauts", json=PAYLOAD)
    assert client.post("/api/v1/astronauts", json=PAYLOAD).status_code == 409


def test_get_missing_astronaut_returns_404(client):
    assert client.get("/api/v1/astronauts/999").status_code == 404


@pytest.mark.parametrize(
    "bad",
    [
        {"crew_code": "X", "full_name": ""},                       # empty name
        {"crew_code": "X", "full_name": "A", "height_cm": -5},      # negative height
        {"full_name": "No crew code"},                              # missing required field
        {"crew_code": "X", "full_name": "A", "weight_kg": "heavy"}, # wrong type
    ],
)
def test_invalid_input_returns_422(client, bad):
    assert client.post("/api/v1/astronauts", json=bad).status_code == 422


def test_update_changes_only_sent_fields(client):
    a = client.post("/api/v1/astronauts", json=PAYLOAD).json()
    r = client.put(f"/api/v1/astronauts/{a['id']}", json={"mission_name": "Mars-1"})
    assert r.status_code == 200
    assert r.json()["mission_name"] == "Mars-1"
    assert r.json()["full_name"] == "Test Astronaut"  # untouched


def test_list_is_paginated(client):
    for i in range(3):
        client.post("/api/v1/astronauts", json={**PAYLOAD, "crew_code": f"AV-{i}"})
    body = client.get("/api/v1/astronauts?limit=2").json()
    assert body["total"] == 3 and len(body["items"]) == 2
    assert client.get("/api/v1/astronauts?limit=0").status_code == 422
