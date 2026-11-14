from datetime import UTC, datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(UTC)


class Base(DeclarativeBase):
    pass


class CreatedMixin:
    # NOTE: SQLite stores datetimes without tzinfo. We always WRITE UTC
    # and treat stored values as UTC.
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
