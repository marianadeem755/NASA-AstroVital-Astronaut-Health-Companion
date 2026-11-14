from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class WellbeingAssessment(CreatedMixin, Base):
    __tablename__ = "wellbeing_assessments"
    __table_args__ = (Index("ix_wellbeing_astronaut_time", "astronaut_id", "assessed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    sleep_quality: Mapped[int]  # 0-10
    mood: Mapped[int]
    stress: Mapped[int]
    fatigue: Mapped[int]
    notes: Mapped[str | None] = mapped_column(Text)
    client_uuid: Mapped[str | None] = mapped_column(String(64), unique=True)


class CognitiveAssessment(CreatedMixin, Base):
    __tablename__ = "cognitive_assessments"
    __table_args__ = (Index("ix_cognitive_astronaut_time", "astronaut_id", "assessed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    wellbeing_id: Mapped[int | None] = mapped_column(ForeignKey("wellbeing_assessments.id"))
    assessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    reaction_time_ms: Mapped[float | None]
    attention_score: Mapped[float | None]  # 0-100
    memory_score: Mapped[float | None]
    task_accuracy: Mapped[float | None]
    client_uuid: Mapped[str | None] = mapped_column(String(64), unique=True)
