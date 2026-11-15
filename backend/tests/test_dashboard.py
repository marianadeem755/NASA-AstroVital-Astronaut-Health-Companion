from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.models.alert import Alert
from app.models.countermeasure import CountermeasureRecommendation
from app.models.risk import RiskAssessment
from app.services.dashboard_service import compute_vital_trends


@pytest.fixture()
def astronaut_id(client):
    return client.post("/api/v1/astronauts", json={"crew_code": "AV-1", "full_name": "T"}).json()["id"]


def ago(days=0, hours=0) -> str:
    return (datetime.now(UTC) - timedelta(days=days, hours=hours)).isoformat()


def obs(client, aid, expect=201, **kw):
    when = kw.pop("when", ago(hours=1))
    r = client.post("/api/v1/observations", json={"astronaut_id": aid, "observed_at": when, **kw})
    assert r.status_code == expect, r.text


# ---------- overview ----------

def test_overview_for_new_astronaut_is_explicitly_empty(client, astronaut_id):
    body = client.get(f"/api/v1/dashboard/{astronaut_id}/overview").json()
    assert body["astronaut"]["crew_code"] == "AV-1"
    assert body["latest_observation"] is None and body["observation_age_minutes"] is None
    assert body["risk"]["overall_level"] is None and body["risk"]["message"]
    assert body["alerts"]["open_total"] == 0 and body["recommendations"]["latest"] == []
    assert body["body_map"]["regions"] == [] and body["wellbeing"] is None
    assert set(body["data_quality"]["missing"]) == {
        "observations", "risk", "alerts", "recommendations", "symptoms", "wellbeing",
    }
    assert "not a diagnosis" in body["note"]


def test_unknown_astronaut_returns_404(client):
    assert client.get("/api/v1/dashboard/999/overview").status_code == 404
    assert client.get("/api/v1/dashboard/999/trends").status_code == 404


def test_overview_assembles_every_section(client, astronaut_id):
    obs(client, astronaut_id, sleep_hours=4, fatigue_level=8, stress_level=8, heart_rate_bpm=70)
    client.post(f"/api/v1/risk/analyze/{astronaut_id}")
    client.post("/api/v1/body-map/symptoms", json={
        "astronaut_id": astronaut_id, "region_code": "head", "symptom_type": "headache", "severity": 6})
    client.post("/api/v1/wellbeing/assessment", json={
        "astronaut_id": astronaut_id, "sleep_quality": 2, "mood": 6, "stress": 8, "fatigue": 7})
    client.post("/api/v1/recommendations/evaluate", json={"astronaut_id": astronaut_id, "refresh_risk": False})

    body = client.get(f"/api/v1/dashboard/{astronaut_id}/overview").json()
    assert body["latest_observation"]["heart_rate_bpm"] == 70
    assert body["observation_stale"] is False and body["observation_age_minutes"] in (60, 61)
    assert body["risk"]["overall_level"] == "critical" and body["risk"]["assessments"]
    assert body["risk"]["assessments"][0]["factors"]
    assert body["alerts"]["open_total"] >= 2 and len(body["alerts"]["latest_open"]) <= 5
    assert body["alerts"]["open_by_priority"]["critical"] >= 1
    assert body["recommendations"]["latest"][0]["status"] == "escalation"
    assert body["recommendations"]["escalation_in_latest"] is True
    assert body["body_map"]["regions"][0]["region_code"] == "head"
    assert body["wellbeing"]["performance_concern_level"] == "high"
    assert body["data_quality"]["missing"] == []
    assert all(v for v in body["data_quality"]["last_updated"].values())


def test_stale_observation_is_flagged(client, astronaut_id):
    obs(client, astronaut_id, heart_rate_bpm=70, when=ago(hours=30))
    body = client.get(f"/api/v1/dashboard/{astronaut_id}/overview").json()
    assert body["observation_stale"] is True and body["observation_age_minutes"] >= 30 * 60


def test_dashboard_is_read_only(client, astronaut_id, db_session):
    obs(client, astronaut_id, sleep_hours=4)

    def counts():
        db_session.expire_all()
        return tuple(
            db_session.scalar(select(func.count()).select_from(m))
            for m in (RiskAssessment, Alert, CountermeasureRecommendation)
        )

    before = counts()
    for _ in range(3):
        client.get(f"/api/v1/dashboard/{astronaut_id}/overview")
        client.get(f"/api/v1/dashboard/{astronaut_id}/trends")
    assert counts() == before == (0, 0, 0)  # loading the dashboard never runs analysis


def test_body_map_summary_only_covers_recent_week(client, astronaut_id):
    for days, region in [(2, "head"), (20, "legs")]:
        client.post("/api/v1/body-map/symptoms", json={
            "astronaut_id": astronaut_id, "region_code": region, "symptom_type": "pain",
            "severity": 5, "reported_at": ago(days=days)})
    regions = client.get(f"/api/v1/dashboard/{astronaut_id}/overview").json()["body_map"]["regions"]
    assert [r["region_code"] for r in regions] == ["head"]


# ---------- trends ----------

def test_trends_combine_all_series(client, astronaut_id):
    for d, hr, sleep in [(25, 60, 8), (24, 62, 8), (3, 80, 5), (2, 84, 4)]:
        obs(client, astronaut_id, when=ago(days=d), heart_rate_bpm=hr, sleep_hours=sleep)
    for d, stress in [(25, 2), (24, 3), (3, 8), (2, 9)]:
        client.post("/api/v1/wellbeing/assessment", json={
            "astronaut_id": astronaut_id, "assessed_at": ago(days=d),
            "sleep_quality": 5, "mood": 5, "stress": stress, "fatigue": 5,
            "cognitive": {"reaction_time_ms": 250}})
    client.post("/api/v1/body-map/symptoms", json={
        "astronaut_id": astronaut_id, "region_code": "neck", "symptom_type": "stiffness", "severity": 4,
        "reported_at": ago(days=5)})
    client.post(f"/api/v1/risk/analyze/{astronaut_id}")

    body = client.get(f"/api/v1/dashboard/{astronaut_id}/trends?days=30").json()
    vitals = {v["metric"]: v for v in body["vitals"]}
    assert vitals["heart_rate_bpm"]["direction"] == "rising" and vitals["heart_rate_bpm"]["unit"] == "bpm"
    assert vitals["sleep_hours"]["direction"] == "falling" and vitals["sleep_hours"]["count"] == 4
    assert len(vitals["heart_rate_bpm"]["daily"]) == 4 and vitals["heart_rate_bpm"]["latest"] == 84
    assert "spo2_percent" not in vitals  # no data -> not invented
    assert {w["metric"]: w for w in body["wellbeing"]}["stress"]["direction"] == "worsening"
    assert body["cognitive"][0]["metric"] == "reaction_time_ms"
    assert body["symptoms"][0]["region_code"] == "neck"
    assert body["risk_history"] and body["risk_history"][0]["category"]
    assert body["days"] == 30 and "rising/falling" in body["method_note"]


def test_trends_empty_and_validation(client, astronaut_id):
    body = client.get(f"/api/v1/dashboard/{astronaut_id}/trends").json()
    for key in ("vitals", "wellbeing", "cognitive", "symptoms", "risk_history"):
        assert body[key] == []
    assert client.get(f"/api/v1/dashboard/{astronaut_id}/trends?days=0").status_code == 422
    assert client.get(f"/api/v1/dashboard/{astronaut_id}/trends?days=366").status_code == 422


# ---------- pure vital-trend helper ----------

def make_obs(days_ago, **vals):
    base = dict.fromkeys(
        ["heart_rate_bpm", "sleep_hours", "spo2_percent", "body_temperature_c", "systolic_bp", "diastolic_bp"]
    )
    return SimpleNamespace(observed_at=datetime.now(UTC) - timedelta(days=days_ago), **{**base, **vals})


def trend_of(observations, metric="heart_rate_bpm"):
    end = datetime.now(UTC)
    result = compute_vital_trends(observations, end - timedelta(days=30), end)
    return next(v for v in result if v.metric == metric)


def test_vital_direction_rules():
    rising = [make_obs(d, heart_rate_bpm=v) for d, v in [(25, 60), (24, 60), (3, 70), (2, 70)]]
    assert trend_of(rising).direction == "rising"
    stable = [make_obs(d, heart_rate_bpm=v) for d, v in [(25, 70), (24, 70), (3, 71), (2, 71)]]
    assert trend_of(stable).direction == "stable"  # +1.4% is under the 5% threshold
    two_points = [make_obs(2, heart_rate_bpm=70), make_obs(1, heart_rate_bpm=90)]
    assert trend_of(two_points).direction == "insufficient_data"
    falling = [make_obs(d, heart_rate_bpm=v) for d, v in [(25, 80), (24, 80), (3, 60), (2, 60)]]
    assert trend_of(falling).direction == "falling"
