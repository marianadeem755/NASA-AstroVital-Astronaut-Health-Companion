from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.sync import ConflictRead, ResolveRequest, SyncPushRequest, SyncPushResponse, SyncStatusResponse
from app.sync import conflict_resolver, sync_service

router = APIRouter(prefix="/sync", tags=["Synchronization"])


@router.post("/push", response_model=SyncPushResponse)
def push_events(payload: SyncPushRequest, db: Session = Depends(get_db)):
    """Send queued offline records. Always 200 when the request itself is valid: look at each
    item's `status` (applied | duplicate | conflict | failed). Safe to re-send any batch."""
    return sync_service.push(db, payload)


@router.get("/status", response_model=SyncStatusResponse)
def sync_status(device_id: str | None = Query(None, max_length=80), db: Session = Depends(get_db)):
    """Event counts by status, last processing time and open conflicts."""
    return sync_service.status(db, device_id)


@router.post("/conflicts/{conflict_id}/resolve", response_model=ConflictRead)
def resolve_conflict(conflict_id: int, payload: ResolveRequest, db: Session = Depends(get_db)):
    """keep_server discards the client version; accept_client stores it as an extra record."""
    return conflict_resolver.resolve(db, conflict_id, payload.resolution)
