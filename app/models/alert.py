from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class Alert(CreatedMixin, Base):
    __tablename__ = "alerts"
    __table_args__ = (Index("ix_alert_astronaut_status", "astronaut_id", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    risk_assessment_id: Mapped[int | None] = mapped_column(ForeignKey("risk_assessments.id"))
    priority: Mapped[str] = mapped_column(String(20))  # low|medium|high|critical
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")  # open|acknowledged
    acknowledged_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    acknowledged_by: Mapped[str | None] = mapped_column(String(120))
