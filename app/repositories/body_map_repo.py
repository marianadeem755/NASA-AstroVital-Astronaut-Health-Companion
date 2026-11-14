from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.body_map import BodyRegion, SymptomReport


def list_regions(db: Session) -> list[BodyRegion]:
    return list(db.scalars(select(BodyRegion).order_by(BodyRegion.id)))


def get_region_by_code(db: Session, code: str) -> BodyRegion | None:
    return db.scalar(select(BodyRegion).where(BodyRegion.code == code))


def get_by_client_uuid(db: Session, client_uuid: str) -> SymptomReport | None:
    return db.scalar(select(SymptomReport).where(SymptomReport.client_uuid == client_uuid))


def create(db: Session, report: SymptomReport) -> tuple[SymptomReport, bool]:
    """Insert; if the client_uuid raced with another request, return the stored row."""
    db.add(report)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if report.client_uuid and (existing := get_by_client_uuid(db, report.client_uuid)):
            return existing, False
        raise
    db.refresh(report)
    return report, True


def _filtered(
    astronaut_id: int,
    region_id: int | None,
    symptom_type: str | None,
    start: datetime | None,
    end: datetime | None,
):
    query = select(SymptomReport).where(SymptomReport.astronaut_id == astronaut_id)
    if region_id is not None:
        query = query.where(SymptomReport.body_region_id == region_id)
    if symptom_type:
        query = query.where(SymptomReport.symptom_type == symptom_type)
    if start:
        query = query.where(SymptomReport.reported_at >= start)
    if end:
        query = query.where(SymptomReport.reported_at <= end)
    return query


def list_for_astronaut(
    db: Session,
    astronaut_id: int,
    skip: int = 0,
    limit: int = 50,
    region_id: int | None = None,
    symptom_type: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
) -> tuple[list[SymptomReport], int]:
    query = _filtered(astronaut_id, region_id, symptom_type, start, end)
    total = db.scalar(select(func.count()).select_from(query.subquery())) or 0
    items = db.scalars(
        query.order_by(SymptomReport.reported_at.desc(), SymptomReport.id.desc()).offset(skip).limit(limit)
    ).all()
    return list(items), total


def all_in_window(
    db: Session,
    astronaut_id: int,
    start: datetime,
    end: datetime,
    region_id: int | None = None,
    symptom_type: str | None = None,
) -> list[SymptomReport]:
    query = _filtered(astronaut_id, region_id, symptom_type, start, end)
    return list(db.scalars(query.order_by(SymptomReport.reported_at)))
