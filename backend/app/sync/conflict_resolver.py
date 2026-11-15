"""Explicit conflict resolution. Conflicts are never resolved automatically: medical data
is not silently dropped or overwritten. Both sides are kept (server row + client snapshot)
until someone chooses.

  keep_server    -> discard the client's version (nothing is deleted from the server)
  accept_client  -> store the client's version as an additional record"""
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models.sync import SyncConflict, SyncEvent
from app.repositories import sync_repo
from app.sync.handlers import HANDLERS


def resolve(db: Session, conflict_id: int, resolution: str) -> SyncConflict:
    conflict = sync_repo.get_conflict(db, conflict_id)
    if conflict is None:
        raise AppError(404, "Conflict not found")
    if conflict.resolution is not None:
        if conflict.resolution == resolution:
            return conflict  # idempotent
        raise AppError(409, f"Conflict already resolved as '{conflict.resolution}'")

    event = db.get(SyncEvent, conflict.sync_event_id)
    now = datetime.now(UTC)
    is_collision = conflict.conflict_type == "timestamp_collision"

    if resolution == "accept_client":
        handler = HANDLERS[event.entity_type]
        payload = dict(conflict.client_snapshot or {})
        base = str(payload.get("client_uuid") or event.client_uuid)
        payload["client_uuid"] = f"{base[:50]}-c{conflict.id}"  # new key; stays within 64 chars
        try:
            data = handler.schema.model_validate(payload)
        except ValidationError as exc:
            raise AppError(422, f"Stored client data is no longer valid: {exc.errors()[0]['msg']}") from exc
        row, _created = handler.apply(db, data)
        if is_collision:
            event.status, event.entity_id, event.processed_at = "applied", row.id, now
    elif is_collision:
        event.status, event.processed_at = "discarded", now

    conflict.resolution = resolution
    conflict.resolved_at = now
    db.commit()
    db.refresh(conflict)
    return conflict
