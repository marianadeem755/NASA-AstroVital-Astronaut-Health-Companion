from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.alert import Alert

PRIORITIES = ["critical", "high", "medium", "low"]


def get(db: Session, alert_id: int) -> Alert | None:
    return db.get(Alert, alert_id)


def list_for_astronaut(
    db: Session,
    astronaut_id: int,
    skip: int,
    limit: int,
    status: str | None = None,
    priority: str | None = None,
) -> tuple[list[Alert], int]:
    query = select(Alert).where(Alert.astronaut_id == astronaut_id)
    if status:
        query = query.where(Alert.status == status)
    if priority:
        query = query.where(Alert.priority == priority)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(query.order_by(Alert.created_at.desc(), Alert.id.desc()).offset(skip).limit(limit)).all()
    return list(items), total


def open_counts_by_priority(db: Session, astronaut_id: int) -> dict[str, int]:
    rows = db.execute(
        select(Alert.priority, func.count())
        .where(Alert.astronaut_id == astronaut_id, Alert.status == "open")
        .group_by(Alert.priority)
    ).all()
    counts = dict(rows)
    return {p: counts.get(p, 0) for p in PRIORITIES}
