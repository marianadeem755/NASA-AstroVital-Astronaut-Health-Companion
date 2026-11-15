from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class ExerciseSession(CreatedMixin, Base):
    """One logged exercise session. Kept apart from observations on purpose: an observation row that
    carries only exercise would show up as an empty 'latest observation' on the other pages."""
    __tablename__ = "exercise_sessions"
    __table_args__ = (Index("ix_exercise_astronaut_time", "astronaut_id", "performed_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    performed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    minutes: Mapped[int]
    kind: Mapped[str] = mapped_column(String(20))  # aerobic | resistive | mixed | other
    client_uuid: Mapped[str | None] = mapped_column(String(64), unique=True)  # offline dedup
