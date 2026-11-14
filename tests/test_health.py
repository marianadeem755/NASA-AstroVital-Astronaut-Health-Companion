def test_health_check(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_unversioned_path_does_not_exist(client):
    assert client.get("/health").status_code == 404
