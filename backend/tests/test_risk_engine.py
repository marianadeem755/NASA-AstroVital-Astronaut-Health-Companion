"""Rule-based risk assessment: pure engine tests + API/persistence tests."""
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.alert import Alert
from app.risk_engine.risk_calculator import analyze

METRICS = [
    "heart_rate_bpm", "sleep_hours", "fatigue_level", "stress_level", "mood_score",
    "spo2_percent", "body_temperature_c", "systolic_bp", "diastolic_bp",
]


def fake_obs(**values):
    return SimpleNamespace(**{m: values.get(m) for m in METRICS})


def by_category(result):
    return {r.category: r for r in result.results}


# ---------- pure engine ----------

def test_normal_values_produce_no_risk():
    r = analyze([fake_obs(heart_rate_bpm=70, sleep_hours=8, stress_level=2)])
    assert r.results == []


def test_single_rule_fires_with_explained_factor():
    r = analyze([fake_obs(sleep_hours=4.5)])
    cat = by_category(r)["sleep_fatigue"]
    assert cat.level == "high"  # <5 h tier
    factor = cat.factors[0]
    assert factor.rule_code == "SLEEP_LOW" and factor.observed_value == 4.5
    assert "Short sleep" in factor.explanation


def test_values_are_averaged_across_window():
    r = analyze([fake_obs(sleep_hours=6), fake_obs(sleep_hours=9)])  # mean 7.5 -> not flagged
    assert r.results == []


def test_cascading_combined_risk_escalates():
    r = analyze([fake_obs(sleep_hours=4, fatigue_level=8, stress_level=8)])
    cats = by_category(r)
    assert cats["sleep_fatigue"].level == "critical"  # 3.0 (sleep <5h) + 2.0 (fatigue) = 5
    combined = cats["combined_cognitive_performance"]
    assert combined.level == "critical"           # boosted, capped at critical
    assert {f.rule_code for f in combined.factors} == {"SLEEP_LOW", "FATIGUE_HIGH", "STRESS_HIGH"}


def test_missing_metrics_are_reported_not_assumed_normal():
    r = analyze([fake_obs(sleep_hours=8)])
    assert "spo2_percent" in r.not_evaluated
    assert "sleep_hours" not in r.not_evaluated


def test_cascade_boosts_above_component_level():
    r = analyze([fake_obs(sleep_hours=6, stress_level=7)])  # medium + medium
    cats = by_category(r)
    assert cats["sleep_fatigue"].level == "medium" and cats["psychological"].level == "medium"
    assert cats["combined_cognitive_performance"].level == "high"


# ---------- tiers and sources ----------

@pytest.mark.parametrize(
    "hours, expected",
    [(4.9, "high"), (5.0, "medium"), (6.0, "medium"), (6.1, "low"), (6.9, "low"), (7.0, None)],
)
def test_sleep_tier_boundaries_follow_aasm(hours, expected):
    cat = by_category(analyze([fake_obs(sleep_hours=hours)])).get("sleep_fatigue")
    assert (cat.level if cat else None) == expected


def test_iss_typical_sleep_is_only_low_level():
    # Barger 2014: ISS crews average ~6 h; should be visible but not alarming on its own.
    assert by_category(analyze([fake_obs(sleep_hours=6.1)]))["sleep_fatigue"].level == "low"


def test_blood_pressure_counts_once_using_highest_category():
    r = analyze([fake_obs(systolic_bp=150, diastolic_bp=95)])  # both stage 2
    cat = by_category(r)["cardiovascular"]
    assert len(cat.factors) == 2 and cat.score == 2.0  # not 4.0


def test_blood_pressure_stage_1_vs_crisis():
    assert by_category(analyze([fake_obs(systolic_bp=135)]))["cardiovascular"].level == "low"
    assert by_category(analyze([fake_obs(systolic_bp=181)]))["cardiovascular"].level == "critical"
    assert "cardiovascular" not in by_category(analyze([fake_obs(systolic_bp=129)]))


def test_spo2_bands():
    assert "respiratory" not in by_category(analyze([fake_obs(spo2_percent=97)]))
    assert by_category(analyze([fake_obs(spo2_percent=93)]))["respiratory"].level == "low"
    assert by_category(analyze([fake_obs(spo2_percent=88)]))["respiratory"].level == "critical"


def test_every_rule_documents_source_and_evidence():
    from app.risk_engine.rules import RULES

    for rule in RULES:
        assert rule.source and rule.evidence in {"guideline", "convention", "design"}
        # tiers must be ordered most-severe first (weights non-increasing)
        weights = [t.weight for t in rule.tiers]
        assert weights == sorted(weights, reverse=True), rule.code


def test_factor_carries_source_and_evidence_label():
    factor = analyze([fake_obs(stress_level=8)]).results[0].factors[0]
    assert factor.evidence == "convention" and "NRS" in factor.source


# ---------- API + persistence ----------

@pytest.fixture()
def astronaut_id(client):
    return client.post("/api/v1/astronauts", json={"crew_code": "AV-1", "full_name": "T"}).json()["id"]


def post_obs(client, astronaut_id, hours_ago=1, **metrics):
    when = (datetime.now(UTC) - timedelta(hours=hours_ago)).isoformat()
    r = client.post("/api/v1/observations", json={"astronaut_id": astronaut_id, "observed_at": when, **metrics})
    assert r.status_code == 201, r.text


def test_analyze_stores_assessments_factors_and_alerts(client, astronaut_id, db_session):
    post_obs(client, astronaut_id, sleep_hours=4, fatigue_level=8, stress_level=8)
    r = client.post(f"/api/v1/risk/analyze/{astronaut_id}")
    assert r.status_code == 200
    body = r.json()
    assert body["overall_level"] == "critical"
    assert body["observations_used"] == 1
    assert body["alerts_created"] >= 1
    assert "not a medical diagnosis" in body["disclaimer"]
    assert all(a["factors"] for a in body["assessments"])
    first_factor = body["assessments"][0]["factors"][0]
    assert first_factor["details"]["source"] and first_factor["details"]["evidence"]

    latest = client.get(f"/api/v1/risk/{astronaut_id}").json()
    assert len(latest) == len(body["assessments"])
    alerts = db_session.scalars(select(Alert).where(Alert.astronaut_id == astronaut_id)).all()
    assert alerts and all(a.risk_assessment_id for a in alerts)


def test_repeat_analysis_does_not_duplicate_open_alerts(client, astronaut_id):
    post_obs(client, astronaut_id, sleep_hours=4)
    first = client.post(f"/api/v1/risk/analyze/{astronaut_id}").json()
    second = client.post(f"/api/v1/risk/analyze/{astronaut_id}").json()
    assert first["alerts_created"] == 1 and second["alerts_created"] == 0


def test_history_is_paginated(client, astronaut_id):
    post_obs(client, astronaut_id, sleep_hours=4)
    client.post(f"/api/v1/risk/analyze/{astronaut_id}")
    client.post(f"/api/v1/risk/analyze/{astronaut_id}")
    page = client.get(f"/api/v1/risk/{astronaut_id}/history?limit=1").json()
    assert page["total"] == 2 and len(page["items"]) == 1


def test_old_observations_outside_window_are_ignored(client, astronaut_id):
    post_obs(client, astronaut_id, hours_ago=200, sleep_hours=3)
    body = client.post(f"/api/v1/risk/analyze/{astronaut_id}").json()
    assert body["observations_used"] == 0 and body["assessments"] == []


def test_risk_unknown_astronaut_returns_404(client):
    assert client.post("/api/v1/risk/analyze/999").status_code == 404
    assert client.get("/api/v1/risk/999").status_code == 404
