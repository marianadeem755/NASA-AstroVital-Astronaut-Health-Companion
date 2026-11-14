from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class BodyRegion(Base):
    __tablename__ = "body_regions"

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(String(80))


class SymptomReport(CreatedMixin, Base):
    __tablename__ = "symptom_reports"
    __table_args__ = (Index("ix_symptom_astronaut_time", "astronaut_id", "reported_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    body_region_id: Mapped[int] = mapped_column(ForeignKey("body_regions.id"), index=True)
    symptom_type: Mapped[str] = mapped_column(String(80), index=True)
    severity: Mapped[int]  # 1-10
    duration_minutes: Mapped[int | None]
    notes: Mapped[str | None] = mapped_column(Text)
    reported_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    client_uuid: Mapped[str | None] = mapped_column(String(64), unique=True)
