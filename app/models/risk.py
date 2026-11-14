from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, CreatedMixin


class RiskAssessment(CreatedMixin, Base):
    __tablename__ = "risk_assessments"
    __table_args__ = (Index("ix_risk_astronaut_time", "astronaut_id", "assessed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    category: Mapped[str] = mapped_column(String(50), index=True)  # e.g. fatigue_sleep
    level: Mapped[str] = mapped_column(String(20))  # low|medium|high|critical
    score: Mapped[float]
    summary: Mapped[str | None] = mapped_column(Text)
    engine_version: Mapped[str] = mapped_column(String(30), default="rules-0.1")
    observation_id: Mapped[int | None] = mapped_column(ForeignKey("observations.id"))
    factors: Mapped[list["RiskFactor"]] = relationship(
        back_populates="assessment", cascade="all, delete-orphan"
    )


class RiskFactor(Base):
    """A single contributing factor, so every risk is explainable."""
    __tablename__ = "risk_factors"

    id: Mapped[int] = mapped_column(primary_key=True)
    assessment_id: Mapped[int] = mapped_column(
        ForeignKey("risk_assessments.id", ondelete="CASCADE"), index=True
    )
    rule_code: Mapped[str] = mapped_column(String(80))
    factor: Mapped[str] = mapped_column(String(80))  # metric name
    observed_value: Mapped[float | None]
    threshold: Mapped[str | None] = mapped_column(String(80))
    weight: Mapped[float] = mapped_column(default=1.0)
    explanation: Mapped[str] = mapped_column(Text)
    details: Mapped[dict | None] = mapped_column(JSON)
    assessment: Mapped[RiskAssessment] = relationship(back_populates="factors")
