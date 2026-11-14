"""Receives queued offline records and applies them safely.

Guarantees:
  - Idempotent: the same client_uuid is applied at most once.
  - Isolated: every event commits on its own; a bad event never affects the others.
  - Honest: each event gets its own result (applied / duplicate / conflict / failed).
  - Lossless: conflicting data is stored for review, never dropped or overwritten.

Event statuses stored in sync_events:
  pending -> applied | duplicate | conflict | failed ; conflict -> applied | discarded (resolved)"""
import logging
from datetime import UTC, datetime

from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models.sync import SyncConflict, SyncEvent
from app.repositories import astronaut_repo, sync_repo
from app.schemas.observation import to_utc
from app.schemas.sync import (
    ConflictRead,
    SyncEventIn,
    SyncEventResult,
    SyncPushRequest,
    SyncPushResponse,
    SyncStatusResponse,
)
from app.sync.handlers import HANDLERS, differs

log = logging.getLogger(__name__)

SETTLED = {"applied", "duplicate", "conflict", "discarded"}  # not retried on re-push


def push(db: Session, req: SyncPushRequest) -> SyncPushResponse:
    results = [_process_event(db, req.device_id, ev) for ev in req.events]
    count = lambda s: sum(r.status == s for r in results)  # noqa: E731
    return SyncPushResponse(
        server_time=datetime.now(UTC), received=len(results), applied=count("applied"),
        duplicates=count("duplicate"), conflicts=count("conflict"), failed=count("failed"),
        results=results,
    )


def status(db: Session, device_id: str | None) -> SyncStatusResponse:
    conflicts, open_total = sync_repo.open_conflicts(db)
    last = sync_repo.last_processed(db, device_id)
    return SyncStatusResponse(
        server_time=datetime.now(UTC), device_id=device_id,
        totals=sync_repo.status_counts(db, device_id),
        last_processed_at=to_utc(last) if last else None,
        open_conflicts=open_total,
        conflicts=[ConflictRead.model_validate(c) for c in conflicts],
    )


# ---- internals -----------------------------------------------------------------------

def _result(ev: SyncEventIn, status_: str, entity_id=None, conflict_id=None, detail=None) -> SyncEventResult:
    return SyncEventResult(
        client_uuid=ev.client_uuid, entity_type=ev.entity_type, status=status_,
        entity_id=entity_id, conflict_id=conflict_id, detail=detail,
    )


def _process_event(db: Session, device_id: str, ev: SyncEventIn) -> SyncEventResult:
    event = sync_repo.get_event(db, ev.client_uuid)
    if event is not None and event.status in SETTLED:
        return _replay(db, event, ev)

    if event is None:
        event = SyncEvent(
            client_uuid=ev.client_uuid, device_id=device_id, entity_type=ev.entity_type,
            payload=ev.payload, status="pending",
            client_timestamp=to_utc(ev.client_timestamp) if ev.client_timestamp else None,
        )
        db.add(event)
        try:
            db.commit()
        except IntegrityError:  # another request inserted the same client_uuid first
            db.rollback()
            existing = sync_repo.get_event(db, ev.client_uuid)
            if existing is not None and existing.status in SETTLED:
                return _replay(db, existing, ev)
            return _result(ev, "failed", detail="Concurrent submission of the same client_uuid; retry")
    else:  # earlier attempt failed: allow a corrected resubmission under the same key
        event.device_id, event.entity_type, event.payload = device_id, ev.entity_type, ev.payload
        event.status, event.error = "pending", None
        db.commit()
    return _apply(db, event, ev)


def _replay(db: Session, event: SyncEvent, ev: SyncEventIn) -> SyncEventResult:
    """The client_uuid was already processed."""
    if event.entity_type != ev.entity_type or event.payload != ev.payload:
        snapshot = {**ev.payload, "client_uuid": ev.client_uuid}
        conflict = sync_repo.conflict_for_snapshot(db, event.id, "payload_mismatch", snapshot)
        if conflict is None:
            conflict = SyncConflict(
                sync_event_id=event.id, conflict_type="payload_mismatch",
                server_snapshot={**event.payload, "client_uuid": event.client_uuid},
                client_snapshot=snapshot,
            )
            db.add(conflict)
            db.commit()
        return _result(ev, "conflict", event.entity_id, conflict.id,
                       "Same client_uuid was already received with different content")
    if event.status == "conflict":
        conflict = db.query(SyncConflict).filter_by(sync_event_id=event.id).order_by(SyncConflict.id).first()
        return _result(ev, "conflict", event.entity_id, conflict.id if conflict else None,
                       "Unresolved conflict; see GET /sync/status")
    return _result(ev, "duplicate", event.entity_id, detail=f"Already processed (status: {event.status})")


def _fail(db: Session, event: SyncEvent, ev: SyncEventIn, message: str) -> SyncEventResult:
    event.status, event.error, event.processed_at = "failed", message[:1000], datetime.now(UTC)
    db.commit()
    return _result(ev, "failed", detail=message)


def _apply(db: Session, event: SyncEvent, ev: SyncEventIn) -> SyncEventResult:
    handler = HANDLERS[ev.entity_type]
    try:
        data = handler.schema.model_validate({**ev.payload, "client_uuid": ev.client_uuid})
    except ValidationError as exc:
        return _fail(db, event, ev, "; ".join(
            f"{'.'.join(str(p) for p in e['loc']) or 'payload'}: {e['msg']}" for e in exc.errors()
        ))

    if astronaut_repo.get(db, data.astronaut_id) is None:
        return _fail(db, event, ev, "Astronaut not found")

    try:
        same = handler.find_same_moment(db, data)
        if same is not None and same.client_uuid != data.client_uuid:
            if differs(handler, same, data):
                conflict = SyncConflict(
                    sync_event_id=event.id, conflict_type="timestamp_collision",
                    server_snapshot=handler.snapshot(same),
                    client_snapshot={**ev.payload, "client_uuid": ev.client_uuid},
                )
                db.add(conflict)
                event.status, event.entity_id, event.processed_at = "conflict", same.id, datetime.now(UTC)
                db.commit()
                return _result(ev, "conflict", same.id, conflict.id,
                               "A different record exists for this astronaut at the same time")
            event.status, event.entity_id, event.processed_at = "duplicate", same.id, datetime.now(UTC)
            db.commit()
            return _result(ev, "duplicate", same.id, detail="Identical record already stored")
        row, created = handler.apply(db, data)
    except AppError as exc:
        db.rollback()
        return _fail(db, event, ev, exc.detail)
    except Exception:  # keep the batch going; the event records the failure
        db.rollback()
        log.exception("sync event %s failed unexpectedly", ev.client_uuid)
        return _fail(db, event, ev, "Internal error while applying this event")

    event.entity_id, event.processed_at = row.id, datetime.now(UTC)
    event.status = "applied" if created else "duplicate"
    db.commit()
    return _result(ev, event.status, row.id,
                   detail=None if created else "Record with this client_uuid already stored")
