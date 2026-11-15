from datetime import date

from sqlalchemy import Date, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class MissionProfile(CreatedMixin, Base):
    """Where the mission goes, when it starts and how long it lasts. One row per astronaut, edited on the Mission Profile page."""
    __tablename__ = "mission_profiles"

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"), unique=True, index=True)
    destination: Mapped[str | None] = mapped_column(String(80))
    launch_date: Mapped[date | None] = mapped_column(Date)
    planned_days: Mapped[int | None]
    crew_role: Mapped[str | None] = mapped_column(String(40))
    crew_size: Mapped[int | None]
    objective: Mapped[str | None] = mapped_column(String(200))
