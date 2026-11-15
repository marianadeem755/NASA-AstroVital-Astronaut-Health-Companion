from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.sync import SyncConflict, SyncEvent


def get_event(db: Session, client_uuid: str) -> SyncEvent | None:
    return db.scalar(select(SyncEvent).where(SyncEvent.client_uuid == client_uuid))


def get_conflict(db: Session, conflict_id: int) -> SyncConflict | None:
    return db.get(SyncConflict, conflict_id)


def conflict_for_snapshot(db: Session, event_id: int, conflict_type: str, client_snapshot: dict) -> SyncConflict | None:
    """Re-pushing the same conflicting data must not create a second conflict."""
    candidates = db.scalars(
        select(SyncConflict).where(
            SyncConflict.sync_event_id == event_id, SyncConflict.conflict_type == conflict_type
        )
    )
    return next((c for c in candidates if c.client_snapshot == client_snapshot), None)


def status_counts(db: Session, device_id: str | None) -> dict[str, int]:
    query = select(SyncEvent.status, func.count()).group_by(SyncEvent.status)
    if device_id:
        query = query.where(SyncEvent.device_id == device_id)
    return {status: n for status, n in db.execute(query).all()}


def last_processed(db: Session, device_id: str | None):
    query = select(func.max(SyncEvent.processed_at))
    if device_id:
        query = query.where(SyncEvent.device_id == device_id)
    return db.scalar(query)


def open_conflicts(db: Session, limit: int = 20) -> tuple[list[SyncConflict], int]:
    base = select(SyncConflict).where(SyncConflict.resolution.is_(None))
    total = db.scalar(select(func.count()).select_from(base.subquery())) or 0
    items = db.scalars(base.order_by(SyncConflict.created_at.desc(), SyncConflict.id.desc()).limit(limit)).all()
    return list(items), total
