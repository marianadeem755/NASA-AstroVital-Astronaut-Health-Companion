from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.wellbeing import CognitiveAssessment, WellbeingAssessment


def get_by_client_uuid(db: Session, client_uuid: str) -> WellbeingAssessment | None:
    return db.scalar(select(WellbeingAssessment).where(WellbeingAssessment.client_uuid == client_uuid))


def create(db: Session, assessment: WellbeingAssessment) -> tuple[WellbeingAssessment, bool]:
    """Insert the wellbeing row and its optional cognitive row in ONE transaction."""
    db.add(assessment)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if assessment.client_uuid and (existing := get_by_client_uuid(db, assessment.client_uuid)):
            return existing, False
        raise
    db.refresh(assessment)
    return assessment, True


def list_for_astronaut(
    db: Session,
    astronaut_id: int,
    skip: int,
    limit: int,
    start: datetime | None = None,
    end: datetime | None = None,
) -> tuple[list[WellbeingAssessment], int]:
    query = select(WellbeingAssessment).where(WellbeingAssessment.astronaut_id == astronaut_id)
    if start:
        query = query.where(WellbeingAssessment.assessed_at >= start)
    if end:
        query = query.where(WellbeingAssessment.assessed_at <= end)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(WellbeingAssessment.assessed_at.desc(), WellbeingAssessment.id.desc())
        .offset(skip)
        .limit(limit)
    ).unique().all()
    return list(items), total


def in_window(db: Session, astronaut_id: int, start: datetime, end: datetime) -> list[WellbeingAssessment]:
    return list(
        db.scalars(
            select(WellbeingAssessment)
            .where(
                WellbeingAssessment.astronaut_id == astronaut_id,
                WellbeingAssessment.assessed_at >= start,
                WellbeingAssessment.assessed_at <= end,
            )
            .order_by(WellbeingAssessment.assessed_at, WellbeingAssessment.id)
        ).unique()
    )


def all_cognitive(db: Session, astronaut_id: int) -> list[CognitiveAssessment]:
    """Every cognitive test for the astronaut, oldest first (used for the personal baseline)."""
    return list(
        db.scalars(
            select(CognitiveAssessment)
            .where(CognitiveAssessment.astronaut_id == astronaut_id)
            .order_by(CognitiveAssessment.assessed_at, CognitiveAssessment.id)
        )
    )
