from datetime import UTC, date, datetime, timedelta
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.schemas.observation import to_utc

NOTE = (
    "Self-reported wellbeing and cognitive indicators only. Flags describe possible "
    "performance concerns and are not psychiatric or medical diagnoses."
)

# Every self-report scale runs from SCALE_MIN to SCALE_MAX (higher is better for sleep_quality
# and mood, worse for stress and fatigue).
SCALE_MIN = 0
SCALE_MAX = 10

# Mood choices the astronaut can pick instead of typing a number, ordered from lowest to highest.
# Each choice is stored as the middle of its equal-sized slice of the scale, so trends, concern
# rules and the database are unchanged. Add or remove a level here and the scores adjust by themselves.
MOOD_LEVELS = ("very_low", "low", "neutral", "good", "very_good")
MOOD_OPTIONS: dict[str, int] = {
    level: round(SCALE_MIN + (i + 0.5) * (SCALE_MAX - SCALE_MIN) / len(MOOD_LEVELS))
    for i, level in enumerate(MOOD_LEVELS)
}
MoodOption = StrEnum("MoodOption", list(MOOD_OPTIONS))


class MoodOptionRead(BaseModel):
    value: str   # send this in "mood_option"
    label: str   # text to show on a button or dropdown
    score: int   # the scale value it is stored as


class CognitiveInput(BaseModel):
    reaction_time_ms: float | None = Field(default=None, gt=0, le=10_000)
    attention_score: float | None = Field(default=None, ge=0, le=100)
    memory_score: float | None = Field(default=None, ge=0, le=100)
    task_accuracy: float | None = Field(default=None, ge=0, le=100)

    @model_validator(mode="after")
    def _at_least_one(self):
        if all(v is None for v in self.model_dump().values()):
            raise ValueError("cognitive block needs at least one measurement")
        return self


class WellbeingCreate(BaseModel):
    """Scales run from SCALE_MIN to SCALE_MAX. Higher is better for sleep_quality and mood;
    higher is worse for stress and fatigue.
    Mood: send EITHER "mood" (a number on the scale) OR "mood_option" (a choice from GET /wellbeing/mood-options)."""
    astronaut_id: int = Field(gt=0)
    assessed_at: datetime | None = None  # defaults to now (UTC)
    sleep_quality: int = Field(ge=SCALE_MIN, le=SCALE_MAX)
    mood: int | None = Field(default=None, ge=SCALE_MIN, le=SCALE_MAX)
    mood_option: MoodOption | None = None
    stress: int = Field(ge=SCALE_MIN, le=SCALE_MAX)
    fatigue: int = Field(ge=SCALE_MIN, le=SCALE_MAX)
    notes: str | None = Field(default=None, max_length=1000)
    cognitive: CognitiveInput | None = None
    client_uuid: str | None = Field(default=None, min_length=8, max_length=64)

    @model_validator(mode="after")
    def _resolve_mood(self):
        if (self.mood is None) == (self.mood_option is None):
            raise ValueError('send exactly one of "mood" (a number on the scale) or "mood_option"')
        if self.mood is None:
            self.mood = MOOD_OPTIONS[self.mood_option.value]  # the option becomes its scale score
        return self

    @field_validator("assessed_at")
    @classmethod
    def _utc(cls, v: datetime | None) -> datetime | None:
        if v is None:
            return None
        v = to_utc(v)
        if v > datetime.now(UTC) + timedelta(minutes=5):
            raise ValueError("assessed_at cannot be in the future")
        return v


class CognitiveRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    reaction_time_ms: float | None
    attention_score: float | None
    memory_score: float | None
    task_accuracy: float | None


class Concern(BaseModel):
    metric: str
    value: int
    level: Literal["medium", "high"]
    message: str
    evidence: str  # "convention": numeric-scale convention, not a validated cut-off


class WellbeingRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    astronaut_id: int
    assessed_at: datetime
    sleep_quality: int
    mood: int
    stress: int
    fatigue: int
    notes: str | None
    client_uuid: str | None
    created_at: datetime
    cognitive: CognitiveRead | None = None
    concerns: list[Concern] = Field(default_factory=list)
    performance_concern_level: Literal["none", "low", "medium", "high"] = "none"


class WellbeingPage(BaseModel):
    items: list[WellbeingRead]
    total: int
    skip: int
    limit: int
    note: str = NOTE


class DailyMean(BaseModel):
    date: date
    mean: float


Direction = Literal["improving", "worsening", "stable", "insufficient_data"]


class MetricTrend(BaseModel):
    metric: str
    higher_is_better: bool
    count: int
    mean: float
    min: float
    max: float
    latest: float
    direction: Direction
    daily: list[DailyMean]


class CognitiveMetricTrend(MetricTrend):
    baseline_mean: float | None = None
    baseline_n: int = 0
    recent_mean: float | None = None
    change_percent: float | None = None
    deviates_from_baseline: bool = False
    baseline_message: str | None = None


class WellbeingTrendResponse(BaseModel):
    astronaut_id: int
    window_start: datetime
    window_end: datetime
    days: int
    assessments_in_window: int
    wellbeing: list[MetricTrend]
    cognitive: list[CognitiveMetricTrend]
    method_note: str
    note: str = NOTE
