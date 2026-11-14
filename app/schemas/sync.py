from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

EntityType = Literal["observation", "symptom", "wellbeing"]


class SyncEventIn(BaseModel):
    # Idempotency key. It is also stored as the record's own client_uuid
    # (any client_uuid inside the payload is ignored in favour of this one).
    client_uuid: str = Field(min_length=8, max_length=64)
    entity_type: EntityType
    client_timestamp: datetime | None = None  # when the device queued it (informational)
    payload: dict  # same shape as the corresponding POST body


class SyncPushRequest(BaseModel):
    device_id: str = Field(min_length=1, max_length=80)
    events: list[SyncEventIn] = Field(min_length=1, max_length=200)


class SyncEventResult(BaseModel):
    client_uuid: str
    entity_type: EntityType
    status: Literal["applied", "duplicate", "conflict", "failed"]
    entity_id: int | None = None
    conflict_id: int | None = None
    detail: str | None = None


class SyncPushResponse(BaseModel):
    server_time: datetime
    received: int
    applied: int
    duplicates: int
    conflicts: int
    failed: int
    results: list[SyncEventResult]


class ConflictRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sync_event_id: int
    conflict_type: str
    server_snapshot: dict | None
    client_snapshot: dict | None
    resolution: str | None
    resolved_at: datetime | None
    created_at: datetime


class SyncStatusResponse(BaseModel):
    server_time: datetime
    device_id: str | None
    totals: dict[str, int]  # event count per status
    last_processed_at: datetime | None
    open_conflicts: int
    conflicts: list[ConflictRead]  # newest open conflicts (max 20)


class ResolveRequest(BaseModel):
    resolution: Literal["keep_server", "accept_client"]
