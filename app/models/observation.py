from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class Observation(CreatedMixin, Base):
    """Physiological observation in the common schema. All metrics are nullable
    because datasets do not all share the same columns."""
    __tablename__ = "observations"
    __table_args__ = (
        UniqueConstraint("dataset_id", "source_record_id", name="uq_obs_source_record"),
        Index("ix_obs_astronaut_time", "astronaut_id", "observed_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    heart_rate_bpm: Mapped[float | None]
    sleep_hours: Mapped[float | None]
    fatigue_level: Mapped[int | None]  # 0-10
    stress_level: Mapped[int | None]   # 0-10
    mood_score: Mapped[int | None]     # 0-10
    spo2_percent: Mapped[float | None]
    body_temperature_c: Mapped[float | None]
    systolic_bp: Mapped[float | None]
    diastolic_bp: Mapped[float | None]
    extra_metrics: Mapped[dict | None] = mapped_column(JSON)  # dataset-specific extras

    # Provenance + data quality
    dataset_id: Mapped[int | None] = mapped_column(ForeignKey("datasets.id"), index=True)
    source_record_id: Mapped[str | None] = mapped_column(String(200))
    client_uuid: Mapped[str | None] = mapped_column(String(64), unique=True)  # offline dedup
    missing_fields: Mapped[list | None] = mapped_column(JSON)
    quality_score: Mapped[float | None]  # 0-1 completeness
