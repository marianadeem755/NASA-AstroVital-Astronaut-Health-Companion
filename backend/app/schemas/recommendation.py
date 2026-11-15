from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Level = Literal["low", "medium", "high", "critical"]


class SymptomInput(BaseModel):
    region_code: str = Field(min_length=1, max_length=40)
    symptom_type: str = Field(min_length=1, max_length=80)
    severity: int = Field(ge=1, le=10)
    duration_minutes: int | None = Field(default=None, ge=0, le=60 * 24 * 365)

    @field_validator("region_code", "symptom_type")
    @classmethod
    def _normalise(cls, v: str) -> str:
        return v.strip().lower().replace(" ", "_")


class EvaluateRequest(BaseModel):
    astronaut_id: int = Field(gt=0)
    symptoms: list[SymptomInput] = Field(default_factory=list, max_length=20)
    # True: re-run the risk engine on stored observations first. False: reuse the latest run.
    refresh_risk: bool = True


class SymptomTrigger(BaseModel):
    type: str
    region: str | None = None
    min_severity: int = Field(default=1, ge=1, le=10)


class TriggerConditions(BaseModel):
    """Validated shape of countermeasure_protocols.trigger_conditions."""
    risk_categories: list[str] = Field(default_factory=list)
    min_risk_level: Level = "medium"
    symptoms: list[SymptomTrigger] = Field(default_factory=list)


class RecommendationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    astronaut_id: int
    title: str
    description: str
    reason: str
    priority: str
    related_factors: list | None
    protocol_code: str | None
    protocol_version: int | None
    source_reference: str | None
    requires_medical_review: bool
    escalation_note: str | None
    status: str
    created_at: datetime


class EvaluateResponse(BaseModel):
    astronaut_id: int
    recommendations: list[RecommendationRead]
    escalation_required: bool
    escalation_instruction: str | None
    message: str
    safety_notes: list[str]
    disclaimer: str


class RecommendationPage(BaseModel):
    items: list[RecommendationRead]
    total: int
    skip: int
    limit: int


class ProtocolRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    version: int
    title: str
    description: str
    trigger_conditions: dict
    priority: str
    requires_medical_review: bool
    source_reference: str | None
    approval_status: str
    is_active: bool


class ProtocolImport(BaseModel):
    """One protocol as written in a protocols JSON file."""
    code: str = Field(min_length=1, max_length=80)
    version: int = Field(default=1, ge=1)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1)
    trigger_conditions: TriggerConditions
    priority: Level = "medium"
    requires_medical_review: bool = True
    source_reference: str | None = Field(default=None, max_length=400)
