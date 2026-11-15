from datetime import date, datetime

from sqlalchemy import Date, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin, utcnow


class Astronaut(CreatedMixin, Base):
    __tablename__ = "astronauts"

    id: Mapped[int] = mapped_column(primary_key=True)
    crew_code: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    date_of_birth: Mapped[date | None] = mapped_column(Date)
    sex: Mapped[str | None] = mapped_column(String(20))
    height_cm: Mapped[float | None]
    weight_kg: Mapped[float | None]
    mission_name: Mapped[str | None] = mapped_column(String(120))
    is_active: Mapped[bool] = mapped_column(default=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
