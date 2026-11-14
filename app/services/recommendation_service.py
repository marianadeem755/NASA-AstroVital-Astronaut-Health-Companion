"""Evaluate workflow: validate -> risk assessments -> engine -> store history -> respond."""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.countermeasure_engine import recommendation_engine
from app.countermeasure_engine.safety_checker import DISCLAIMER
from app.models.countermeasure import CountermeasureRecommendation
from app.repositories import recommendation_repo, risk_repo
from app.schemas.recommendation import EvaluateRequest, EvaluateResponse
from app.services import risk_service


def evaluate(db: Session, req: EvaluateRequest) -> EvaluateResponse:
    unknown = {s.region_code for s in req.symptoms} - recommendation_repo.known_region_codes(db)
    if unknown:
        raise AppError(422, f"Unknown body region(s): {', '.join(sorted(unknown))}")

    if req.refresh_risk:
        assessments = risk_service.analyze_astronaut(db, req.astronaut_id).assessments
    else:
        assessments = risk_repo.latest_run(db, req.astronaut_id)

    protocols = recommendation_repo.list_protocols(db, active_only=True)
    output = recommendation_engine.evaluate(protocols, assessments, req.symptoms)

    records = [
        CountermeasureRecommendation(
            astronaut_id=req.astronaut_id,
            protocol_id=d.protocol.id if d.protocol else None,
            risk_assessment_id=d.risk_assessment_id,
            title=d.title,
            description=d.description,
            reason=d.reason,
            priority=d.priority,
            related_factors=d.related_factors,
            protocol_code=d.protocol.code if d.protocol else None,
            protocol_version=d.protocol.version if d.protocol else None,
            source_reference=d.protocol.source_reference if d.protocol else None,
            requires_medical_review=d.requires_medical_review,
            escalation_note=d.escalation_note,
            status=d.status,
        )
        for d in output.drafts
    ]
    db.add_all(records)
    db.commit()
    for r in records:
        db.refresh(r)

    return EvaluateResponse(
        astronaut_id=req.astronaut_id,
        recommendations=records,
        escalation_required=output.escalation_required,
        escalation_instruction=output.escalation_instruction,
        message=output.message,
        safety_notes=output.safety_notes,
        disclaimer=DISCLAIMER,
    )
