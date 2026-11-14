from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.alert import Alert
from app.models.risk import RiskAssessment


def latest_run(db: Session, astronaut_id: int) -> list[RiskAssessment]:
    """Assessments from the most recent analysis run (they share one assessed_at)."""
    latest = db.scalar(
        select(func.max(RiskAssessment.assessed_at)).where(RiskAssessment.astronaut_id == astronaut_id)
    )
    if latest is None:
        return []
    return list(
        db.scalars(
            select(RiskAssessment)
            .options(selectinload(RiskAssessment.factors))
            .where(RiskAssessment.astronaut_id == astronaut_id, RiskAssessment.assessed_at == latest)
            .order_by(RiskAssessment.id)
        )
    )


def history(db: Session, astronaut_id: int, skip: int, limit: int) -> tuple[list[RiskAssessment], int]:
    base = select(RiskAssessment).where(RiskAssessment.astronaut_id == astronaut_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(
        base.options(selectinload(RiskAssessment.factors))
        .order_by(RiskAssessment.assessed_at.desc(), RiskAssessment.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return list(items), total


def open_alert_exists(db: Session, astronaut_id: int, title: str, priority: str) -> bool:
    return (
        db.scalar(
            select(Alert.id).where(
                Alert.astronaut_id == astronaut_id,
                Alert.title == title,
                Alert.priority == priority,
                Alert.status == "open",
            )
        )
        is not None
    )
