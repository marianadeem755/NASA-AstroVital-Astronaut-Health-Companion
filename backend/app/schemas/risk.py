from datetime import datetime

from pydantic import BaseModel, ConfigDict


class RiskFactorRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rule_code: str
    factor: str
    observed_value: float | None
    threshold: str | None
    weight: float
    explanation: str
    details: dict | None = None


class RiskAssessmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    astronaut_id: int
    assessed_at: datetime
    category: str
    level: str
    score: float
    summary: str | None
    engine_version: str
    factors: list[RiskFactorRead]


class AnalyzeResponse(BaseModel):
    astronaut_id: int
    observations_used: int
    overall_level: str
    assessments: list[RiskAssessmentRead]
    not_evaluated: list[str]
    alerts_created: int
    disclaimer: str


class RiskHistoryPage(BaseModel):
    items: list[RiskAssessmentRead]
    total: int
    skip: int
    limit: int
