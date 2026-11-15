"""Orchestrates: load observations -> run pure engine -> persist results -> raise alerts.
Everything is saved in ONE transaction, so a run is stored completely or not at all."""
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from app.models.alert import Alert
from app.models.risk import RiskAssessment, RiskFactor
from app.repositories import observation_repo, risk_repo
from app.risk_engine import risk_calculator
from app.risk_engine.explanations import DISCLAIMER
from app.risk_engine.rules import ENGINE_VERSION, LEVELS, LOOKBACK_HOURS
from app.schemas.risk import AnalyzeResponse

ALERT_MIN_LEVEL = "medium"  # low-level results are stored but do not raise alerts


def analyze_astronaut(db: Session, astronaut_id: int) -> AnalyzeResponse:
    now = datetime.now(UTC)
    observations, _ = observation_repo.list_for_astronaut(
        db, astronaut_id, skip=0, limit=1000, start=now - timedelta(hours=LOOKBACK_HOURS)
    )
    analysis = risk_calculator.analyze(observations)
    latest_obs_id = observations[0].id if observations else None

    assessments: list[RiskAssessment] = []
    alerts_created = 0
    for result in analysis.results:
        assessment = RiskAssessment(
            astronaut_id=astronaut_id, assessed_at=now, category=result.category,
            level=result.level, score=result.score, summary=result.summary,
            engine_version=ENGINE_VERSION, observation_id=latest_obs_id,
            factors=[
                RiskFactor(
                    rule_code=f.rule_code, factor=f.factor, observed_value=f.observed_value,
                    threshold=f.threshold, weight=f.weight, explanation=f.explanation,
                    details={"severity": f.severity, "source": f.source, "evidence": f.evidence},
                )
                for f in result.factors
            ],
        )
        db.add(assessment)
        db.flush()  # assigns assessment.id so the alert can reference it
        assessments.append(assessment)

        if LEVELS.index(result.level) >= LEVELS.index(ALERT_MIN_LEVEL):
            title = f"Risk: {result.category.replace('_', ' ')}"
            if not risk_repo.open_alert_exists(db, astronaut_id, title, result.level):
                db.add(Alert(
                    astronaut_id=astronaut_id, risk_assessment_id=assessment.id, priority=result.level,
                    title=title, message=result.summary or title,
                ))
                alerts_created += 1
    db.commit()
    for a in assessments:
        db.refresh(a)

    overall = max((a.level for a in assessments), key=LEVELS.index, default="low")
    return AnalyzeResponse(
        astronaut_id=astronaut_id, observations_used=analysis.observations_used,
        overall_level=overall, assessments=assessments, not_evaluated=analysis.not_evaluated,
        alerts_created=alerts_created, disclaimer=DISCLAIMER,
    )
