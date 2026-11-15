from datetime import UTC, date, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.observation import to_utc


class RegionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    code: str
    name: str


class SymptomCreate(BaseModel):
    astronaut_id: int = Field(gt=0)
    region_code: str = Field(min_length=1, max_length=40)
    symptom_type: str = Field(min_length=1, max_length=80)
    severity: int = Field(ge=1, le=10)
    duration_minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 365)
    notes: str | None = Field(default=None, max_length=1000)
    reported_at: datetime | None = None  # defaults to "now" (UTC) when omitted
    client_uuid: str | None = Field(default=None, min_length=8, max_length=64)

    @field_validator("region_code", "symptom_type")
    @classmethod
    def _normalise(cls, v: str) -> str:
        return "_".join(v.strip().lower().split())

    @field_validator("reported_at")
    @classmethod
    def _utc(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        v = to_utc(v)
        if v > datetime.now(UTC) + timedelta(minutes=5):
            raise ValueError("reported_at cannot be in the future")
        return v


class SymptomRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    astronaut_id: int
    region_code: str
    region_name: str
    symptom_type: str
    severity: int
    duration_minutes: int | None
    notes: str | None
    reported_at: datetime
    client_uuid: str | None
    created_at: datetime


class SymptomPage(BaseModel):
    items: list[SymptomRead]
    total: int
    skip: int
    limit: int


class DailyPoint(BaseModel):
    date: date
    count: int
    max_severity: int
    mean_severity: float


class RegionTrend(BaseModel):
    region_code: str
    region_name: str
    count: int
    mean_severity: float
    max_severity: int
    latest_severity: int
    latest_reported_at: datetime
    trend: Literal["worsening", "improving", "stable", "insufficient_data"]
    symptom_types: dict[str, int]
    daily: list[DailyPoint]


class TrendResponse(BaseModel):
    astronaut_id: int
    window_start: datetime
    window_end: datetime
    days: int
    total_reports: int
    regions: list[RegionTrend]
    method_note: str
