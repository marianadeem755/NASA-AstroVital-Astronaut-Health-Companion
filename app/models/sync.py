from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class SyncEvent(CreatedMixin, Base):
    __tablename__ = "sync_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    client_uuid: Mapped[str] = mapped_column(String(64), unique=True)  # idempotency key
    device_id: Mapped[str | None] = mapped_column(String(80), index=True)
    entity_type: Mapped[str] = mapped_column(String(40))  # observation|symptom|wellbeing
    entity_id: Mapped[int | None]
    payload: Mapped[dict] = mapped_column(JSON)
    client_timestamp: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # pending | applied | duplicate | conflict | failed | discarded (conflict resolved: keep_server)
    status: Mapped[str] = mapped_column(String(20), default="pending", index=True)
    error: Mapped[str | None] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class SyncConflict(CreatedMixin, Base):
    __tablename__ = "sync_conflicts"

    id: Mapped[int] = mapped_column(primary_key=True)
    sync_event_id: Mapped[int] = mapped_column(ForeignKey("sync_events.id"), index=True)
    conflict_type: Mapped[str] = mapped_column(String(40))
    server_snapshot: Mapped[dict | None] = mapped_column(JSON)
    client_snapshot: Mapped[dict | None] = mapped_column(JSON)
    resolution: Mapped[str | None] = mapped_column(String(40))
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
