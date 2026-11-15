"""Recommendation engine: protocol matching, safety checks, escalation, persistence."""
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.countermeasure_engine import protocol_matcher, recommendation_engine, safety_checker
from app.countermeasure_engine.protocol_loader import load_protocols_file
from app.models.countermeasure import CountermeasureProtocol, CountermeasureRecommendation
from app.schemas.recommendation import SymptomInput

EXAMPLE_FILE = Path(__file__).parent.parent / "data" / "sample" / "protocols.example.json"


def protocol(**overrides) -> CountermeasureProtocol:
    base = dict(
        id=1, code="T-SLEEP", version=1, title="Review sleep schedule",
        description="Keep consistent sleep and wake times and log sleep quality.",
        trigger_conditions={"risk_categories": ["sleep_fatigue"], "min_risk_level": "medium"},
        priority="medium", requires_medical_review=False,
        source_reference="TEST SOURCE", approval_status="approved", is_active=True,
    )
    return CountermeasureProtocol(**{**base, **overrides})


def risk(category="sleep_fatigue", level="high", id=7):
    return SimpleNamespace(category=category, level=level, id=id)


def symptom(**kw):
    base = {"region_code": "head", "symptom_type": "headache", "severity": 5}
    return SymptomInput(**{**base, **kw})


# ---------- matcher ----------

def test_risk_match_respects_minimum_level():
    p = protocol()
    assert protocol_matcher.match_protocol(p, protocol_matcher.build_findings([risk(level="high")], []))
    assert not protocol_matcher.match_protocol(p, protocol_matcher.build_findings([risk(level="low")], []))
    assert not protocol_matcher.match_protocol(p, protocol_matcher.build_findings([risk("psychological")], []))


def test_symptom_match_checks_type_region_and_severity():
    p = protocol(trigger_conditions={"symptoms": [{"type": "headache", "region": "head", "min_severity": 4}]})
    match = lambda s: protocol_matcher.match_protocol(p, protocol_matcher.build_findings([], [s]))  # noqa: E731
    assert match(symptom(severity=4))
    assert not match(symptom(severity=3))
    assert not match(symptom(region_code="legs"))
    assert not match(symptom(symptom_type="nausea"))


def test_malformed_trigger_conditions_never_match():
    p = protocol(trigger_conditions={"min_risk_level": "extreme"})
    assert not protocol_matcher.match_protocol(p, protocol_matcher.build_findings([risk()], []))


# ---------- safety ----------

@pytest.mark.parametrize(
    "overrides, reason_part",
    [
        ({"is_active": False}, "not active"),
        ({"approval_status": "pending_approval"}, "approval status"),
        ({"source_reference": None}, "source reference"),
        ({"description": "Take 500 mg before sleep."}, "dosage"),
        ({"description": "Ask about a prescription for sleep."}, "medication language"),
        ({"title": "Use a sedative at night"}, "medication language"),
    ],
)
def test_unsafe_protocols_are_blocked(overrides, reason_part):
    result = safety_checker.filter_protocols([protocol(**overrides)])
    assert result.allowed == []
    assert reason_part in result.blocked[0][1]


def test_clean_approved_protocol_is_allowed():
    assert len(safety_checker.filter_protocols([protocol()]).allowed) == 1


# ---------- engine ----------

def test_no_findings_means_no_recommendations_and_no_escalation():
    out = recommendation_engine.evaluate([protocol()], [], [])
    assert out.drafts == [] and not out.escalation_required


def test_recommendation_wording_comes_verbatim_from_protocol():
    p = protocol()
    out = recommendation_engine.evaluate([p], [risk()], [])
    draft = out.drafts[0]
    assert draft.title == p.title and draft.description == p.description
    assert draft.protocol is p and draft.risk_assessment_id == 7
    assert "sleep fatigue risk (high)" in draft.reason


def test_priority_is_raised_to_finding_level_but_protocol_priority_is_kept_as_floor():
    out = recommendation_engine.evaluate([protocol(priority="medium")], [risk(level="high")], [])
    assert out.drafts[0].priority == "high"
    out = recommendation_engine.evaluate([protocol(priority="high")], [risk(level="medium")], [])
    assert out.drafts[0].priority == "high"


def test_findings_without_any_protocol_escalate_instead_of_inventing_advice():
    out = recommendation_engine.evaluate([], [risk(level="medium")], [])
    assert out.escalation_required
    draft = out.drafts[0]
    assert draft.protocol is None and draft.status == "escalation" and draft.requires_medical_review
    assert draft.description == safety_checker.ESCALATION_NO_PROTOCOL


def test_unapproved_protocols_are_reported_and_not_used():
    out = recommendation_engine.evaluate([protocol(approval_status="pending_approval")], [risk()], [])
    assert out.drafts[0].protocol is None
    assert any("T-SLEEP not used" in n for n in out.safety_notes)


def test_red_flag_forces_escalation_review_and_critical_priority():
    p = protocol(requires_medical_review=False)
    out = recommendation_engine.evaluate([p], [risk(level="medium")], [symptom(severity=9)])
    assert out.escalation_required
    assert out.escalation_instruction == safety_checker.ESCALATION_RED_FLAG
    sleep_draft = next(d for d in out.drafts if d.protocol is p)
    assert sleep_draft.requires_medical_review is True  # raised from False
    assert sleep_draft.priority == "critical"


def test_chest_symptom_is_a_red_flag_at_lower_severity():
    out = recommendation_engine.evaluate([], [], [symptom(region_code="chest", symptom_type="pain", severity=7)])
    assert out.escalation_required and any("chest" in n for n in out.safety_notes)


def test_higher_priority_recommendations_come_first():
    low = protocol(id=1, code="A", priority="low", trigger_conditions={"risk_categories": ["sleep_fatigue"], "min_risk_level": "low"})
    high = protocol(id=2, code="B", priority="high", trigger_conditions={"risk_categories": ["sleep_fatigue"], "min_risk_level": "low"})
    out = recommendation_engine.evaluate([low, high], [risk(level="low")], [])
    assert [d.protocol.code for d in out.drafts] == ["B", "A"]


# ---------- loader ----------

def test_example_protocols_load_inactive_and_pending(db_session):
    summary = load_protocols_file(db_session, EXAMPLE_FILE)
    assert summary["inserted"] == 7 and summary["invalid"] == []
    rows = db_session.scalars(select(CountermeasureProtocol)).all()
    assert all(not r.is_active and r.approval_status == "pending_approval" for r in rows)


def test_loader_is_idempotent_and_never_modifies_existing(db_session):
    load_protocols_file(db_session, EXAMPLE_FILE)
    row = db_session.scalars(select(CountermeasureProtocol)).first()
    row.title = "locally edited"
    db_session.commit()
    summary = load_protocols_file(db_session, EXAMPLE_FILE)
    assert summary["inserted"] == 0 and summary["skipped_existing"] == 7
    db_session.refresh(row)
    assert row.title == "locally edited"


def test_loader_reports_invalid_entries(db_session, tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text('{"protocols": [{"code": "X", "title": "t"}]}', encoding="utf-8")
    summary = load_protocols_file(db_session, bad)
    assert summary["inserted"] == 0 and len(summary["invalid"]) == 1


def test_all_example_protocols_pass_the_safety_screen(db_session):
    load_protocols_file(db_session, EXAMPLE_FILE)
    for row in db_session.scalars(select(CountermeasureProtocol)):
        assert safety_checker.text_violation(f"{row.title}. {row.description}") is None, row.code


# ---------- API ----------

@pytest.fixture()
def astronaut_id(client):
    return client.post("/api/v1/astronauts", json={"crew_code": "AV-1", "full_name": "T"}).json()["id"]


def post_obs(client, astronaut_id, **metrics):
    when = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    r = client.post("/api/v1/observations", json={"astronaut_id": astronaut_id, "observed_at": when, **metrics})
    assert r.status_code == 201, r.text


def test_evaluate_with_no_approved_protocols_escalates(client, astronaut_id, db_session):
    load_protocols_file(db_session, EXAMPLE_FILE)  # pending only
    post_obs(client, astronaut_id, sleep_hours=5.5)
    body = client.post("/api/v1/recommendations/evaluate", json={"astronaut_id": astronaut_id}).json()
    assert body["escalation_required"] is True
    assert body["recommendations"][0]["protocol_code"] is None
    assert body["recommendations"][0]["status"] == "escalation"
    assert body["recommendations"][0]["description"] == safety_checker.ESCALATION_NO_PROTOCOL
    assert "not a diagnosis" in body["disclaimer"]


def test_active_but_unapproved_protocol_is_blocked_and_reported(client, astronaut_id, db_session):
    # Defence in depth: someone flips is_active without approving the protocol.
    load_protocols_file(db_session, EXAMPLE_FILE)
    row = db_session.scalars(select(CountermeasureProtocol).where(CountermeasureProtocol.code == "EX-SLEEP-HYGIENE")).one()
    row.is_active = True
    db_session.commit()
    post_obs(client, astronaut_id, sleep_hours=5.5)
    body = client.post("/api/v1/recommendations/evaluate", json={"astronaut_id": astronaut_id}).json()
    assert body["recommendations"][0]["protocol_code"] is None
    assert any("EX-SLEEP-HYGIENE not used" in n for n in body["safety_notes"])


def test_evaluate_with_approved_protocols_returns_sourced_recommendations(client, astronaut_id, db_session):
    load_protocols_file(db_session, EXAMPLE_FILE, activate=True)
    post_obs(client, astronaut_id, sleep_hours=5.5)  # inadequate -> medium sleep_fatigue
    body = client.post("/api/v1/recommendations/evaluate", json={"astronaut_id": astronaut_id}).json()
    rec = body["recommendations"][0]
    assert rec["protocol_code"] == "EX-SLEEP-HYGIENE" and rec["protocol_version"] == 1
    assert rec["source_reference"] and rec["related_factors"] and rec["reason"]
    assert body["escalation_required"] is False

    history = client.get(f"/api/v1/recommendations/{astronaut_id}").json()
    assert history["total"] == 1 and history["items"][0]["id"] == rec["id"]
    stored = db_session.scalars(select(CountermeasureRecommendation)).all()
    assert stored[0].risk_assessment_id is not None


def test_evaluate_symptom_matches_protocol_and_severe_symptom_escalates(client, astronaut_id, db_session):
    load_protocols_file(db_session, EXAMPLE_FILE, activate=True)
    symptoms = [{"region_code": "head", "symptom_type": "Headache", "severity": 9}]
    body = client.post(
        "/api/v1/recommendations/evaluate", json={"astronaut_id": astronaut_id, "symptoms": symptoms}
    ).json()
    codes = [r["protocol_code"] for r in body["recommendations"]]
    assert "EX-SYMPTOM-HEADACHE" in codes
    assert body["escalation_required"] is True
    assert all(r["requires_medical_review"] for r in body["recommendations"])


def test_evaluate_nothing_to_report(client, astronaut_id):
    body = client.post("/api/v1/recommendations/evaluate", json={"astronaut_id": astronaut_id}).json()
    assert body["recommendations"] == [] and body["escalation_required"] is False


def test_evaluate_validation_errors(client, astronaut_id):
    bad_region = {"astronaut_id": astronaut_id, "symptoms": [{"region_code": "elbow2", "symptom_type": "x", "severity": 3}]}
    assert client.post("/api/v1/recommendations/evaluate", json=bad_region).status_code == 422
    bad_sev = {"astronaut_id": astronaut_id, "symptoms": [{"region_code": "head", "symptom_type": "x", "severity": 11}]}
    assert client.post("/api/v1/recommendations/evaluate", json=bad_sev).status_code == 422
    assert client.post("/api/v1/recommendations/evaluate", json={"astronaut_id": 999}).status_code == 404
    assert client.get("/api/v1/recommendations/999").status_code == 404


def test_protocols_endpoint_filters_by_active(client, db_session):
    load_protocols_file(db_session, EXAMPLE_FILE)  # all inactive
    assert client.get("/api/v1/recommendations/protocols").json() == []
    assert len(client.get("/api/v1/recommendations/protocols?active_only=false").json()) == 7
