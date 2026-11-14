from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

from app.schemas.alert import AlertRead
from app.schemas.astronaut import AstronautRead
from app.schemas.body_map import RegionTrend
from app.schemas.observation import ObservationRead
from app.schemas.recommendation import RecommendationRead
from app.schemas.risk import RiskAssessmentRead
from app.schemas.wellbeing import CognitiveMetricTrend, MetricTrend, WellbeingRead

NOTE = (
    "Read-only summary of stored data. Nothing here is recomputed on request; each section "
    "shows when its data was last updated. Decision-support only, not a diagnosis."
)


# ---------- overview ----------

class RiskSummary(BaseModel):
    overall_level: str | None  # None = no stored assessment
    assessed_at: datetime | None
    assessments: list[RiskAssessmentRead]
    message: str | None = None


class AlertSummary(BaseModel):
    open_total: int
    open_by_priority: dict[str, int]
    latest_open: list[AlertRead]


class RecommendationSummary(BaseModel):
    latest: list[RecommendationRead]
    escalation_in_latest: bool


class BodyRegionSummary(BaseModel):
    region_code: str
    region_name: str
    count: int
    max_severity: int
    latest_severity: int
    latest_reported_at: datetime
    trend: str


class BodyMapSummary(BaseModel):
    window_days: int
    regions: list[BodyRegionSummary]


class DataQuality(BaseModel):
    last_updated: dict[str, datetime | None]
    missing: list[str]  # sources with no data at all


class OverviewResponse(BaseModel):
    generated_at: datetime
    astronaut: AstronautRead
    latest_observation: ObservationRead | None
    observation_age_minutes: int | None
    observation_stale: bool | None
    risk: RiskSummary
    alerts: AlertSummary
    recommendations: RecommendationSummary
    body_map: BodyMapSummary
    wellbeing: WellbeingRead | None
    data_quality: DataQuality
    note: str = NOTE


# ---------- trends ----------

class VitalDaily(BaseModel):
    date: date
    mean: float
    min: float
    max: float


class VitalTrend(BaseModel):
    metric: str
    unit: str
    count: int
    mean: float
    min: float
    max: float
    latest: float
    # Vitals have no universal "good" direction, so this is rising/falling, not better/worse.
    direction: Literal["rising", "falling", "stable", "insufficient_data"]
    daily: list[VitalDaily]


class RiskPoint(BaseModel):
    assessed_at: datetime
    category: str
    level: str
    score: float


class TrendsResponse(BaseModel):
    astronaut_id: int
    window_start: datetime
    window_end: datetime
    days: int
    vitals: list[VitalTrend]
    wellbeing: list[MetricTrend]
    cognitive: list[CognitiveMetricTrend]
    symptoms: list[RegionTrend]
    risk_history: list[RiskPoint]
    method_note: str
    note: str = NOTE
