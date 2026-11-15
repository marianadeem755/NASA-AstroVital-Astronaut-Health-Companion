from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.observation import Observation
from app.schemas.observation import METRIC_FIELDS, ObservationCreate


def get_by_client_uuid(db: Session, client_uuid: str) -> Observation | None:
    return db.scalar(select(Observation).where(Observation.client_uuid == client_uuid))


def build(data: ObservationCreate) -> Observation:
    """Create the ORM object and compute data-quality info (missing fields, completeness)."""
    values = data.model_dump()
    missing = [f for f in METRIC_FIELDS if values[f] is None]
    quality = round((len(METRIC_FIELDS) - len(missing)) / len(METRIC_FIELDS), 3)
    return Observation(**values, missing_fields=missing, quality_score=quality)


def create(db: Session, data: ObservationCreate) -> tuple[Observation, bool]:
    """Insert an observation. Returns (observation, created).
    If client_uuid was already stored, returns the existing row and created=False."""
    if data.client_uuid:
        existing = get_by_client_uuid(db, data.client_uuid)
        if existing:
            return existing, False
    obs = build(data)
    db.add(obs)
    try:
        db.commit()
    except IntegrityError:
        # Two requests with the same client_uuid raced; the unique index caught it.
        db.rollback()
        if data.client_uuid and (existing := get_by_client_uuid(db, data.client_uuid)):
            return existing, False
        raise
    db.refresh(obs)
    return obs, True


def list_for_astronaut(
    db: Session,
    astronaut_id: int,
    skip: int = 0,
    limit: int = 50,
    start: datetime | None = None,
    end: datetime | None = None,
) -> tuple[list[Observation], int]:
    query = select(Observation).where(Observation.astronaut_id == astronaut_id)
    if start:
        query = query.where(Observation.observed_at >= start)
    if end:
        query = query.where(Observation.observed_at <= end)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(Observation.observed_at.desc(), Observation.id.desc())
        .offset(skip)
        .limit(limit)
    ).all()
    return list(items), total


def latest_for_astronaut(db: Session, astronaut_id: int) -> Observation | None:
    return db.scalar(
        select(Observation)
        .where(Observation.astronaut_id == astronaut_id)
        .order_by(Observation.observed_at.desc(), Observation.id.desc())
        .limit(1)
    )
