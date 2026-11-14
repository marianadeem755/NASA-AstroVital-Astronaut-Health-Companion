from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.body_map import BodyRegion
from app.models.countermeasure import CountermeasureProtocol, CountermeasureRecommendation


def list_protocols(db: Session, active_only: bool = True) -> list[CountermeasureProtocol]:
    query = select(CountermeasureProtocol).order_by(CountermeasureProtocol.code, CountermeasureProtocol.version)
    if active_only:
        query = query.where(CountermeasureProtocol.is_active.is_(True))
    return list(db.scalars(query))


def history(db: Session, astronaut_id: int, skip: int, limit: int) -> tuple[list[CountermeasureRecommendation], int]:
    base = select(CountermeasureRecommendation).where(CountermeasureRecommendation.astronaut_id == astronaut_id)
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(
        base.order_by(CountermeasureRecommendation.created_at.desc(), CountermeasureRecommendation.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return list(items), total


def known_region_codes(db: Session) -> set[str]:
    return set(db.scalars(select(BodyRegion.code)))
