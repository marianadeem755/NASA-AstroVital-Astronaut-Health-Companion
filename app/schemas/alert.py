from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    astronaut_id: int
    risk_assessment_id: int | None
    priority: Literal["low", "medium", "high", "critical"]
    title: str
    message: str
    status: Literal["open", "acknowledged"]
    acknowledged_at: datetime | None
    acknowledged_by: str | None
    created_at: datetime


class AlertPage(BaseModel):
    items: list[AlertRead]
    total: int
    skip: int
    limit: int
    open_by_priority: dict[str, int]  # across ALL of the astronaut's open alerts, ignoring filters


class AcknowledgeRequest(BaseModel):
    # No authentication yet: the client states who acknowledged. Replace with the
    # authenticated crew member once auth exists.
    acknowledged_by: str | None = Field(default=None, max_length=120)

    @field_validator("acknowledged_by")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() or None if v else None
