from sqlalchemy import JSON, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class CountermeasureProtocol(CreatedMixin, Base):
    """Predefined protocol. Recommendations may ONLY come from rows here."""
    __tablename__ = "countermeasure_protocols"
    __table_args__ = (UniqueConstraint("code", "version", name="uq_protocol_code_version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    code: Mapped[str] = mapped_column(String(80), index=True)
    version: Mapped[int] = mapped_column(default=1)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    # Match conditions, e.g. {"risk_categories": [...], "symptoms": [...], "regions": [...]}
    trigger_conditions: Mapped[dict] = mapped_column(JSON)
    priority: Mapped[str] = mapped_column(String(20), default="medium")
    requires_medical_review: Mapped[bool] = mapped_column(default=True)
    source_reference: Mapped[str | None] = mapped_column(String(400))
    approval_status: Mapped[str] = mapped_column(String(30), default="pending_approval")
    # Only approved protocols should ever be activated.
    is_active: Mapped[bool] = mapped_column(default=False, index=True)


class CountermeasureRecommendation(CreatedMixin, Base):
    """Historical record. Protocol code/version/title are snapshotted."""
    __tablename__ = "countermeasure_recommendations"
    __table_args__ = (Index("ix_reco_astronaut_time", "astronaut_id", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    astronaut_id: Mapped[int] = mapped_column(ForeignKey("astronauts.id"))
    protocol_id: Mapped[int | None] = mapped_column(ForeignKey("countermeasure_protocols.id"))
    risk_assessment_id: Mapped[int | None] = mapped_column(ForeignKey("risk_assessments.id"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(Text)
    priority: Mapped[str] = mapped_column(String(20))
    related_factors: Mapped[list | None] = mapped_column(JSON)
    protocol_code: Mapped[str | None] = mapped_column(String(80))
    protocol_version: Mapped[int | None]
    source_reference: Mapped[str | None] = mapped_column(String(400))
    requires_medical_review: Mapped[bool] = mapped_column(default=True)
    escalation_note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="active")
