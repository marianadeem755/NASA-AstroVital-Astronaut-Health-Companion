from datetime import datetime

from sqlalchemy import JSON, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, CreatedMixin


class Dataset(CreatedMixin, Base):
    """One imported source file/dataset. Preserves provenance."""
    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), index=True)
    source: Mapped[str | None] = mapped_column(String(300))  # URL / citation
    file_name: Mapped[str | None] = mapped_column(String(300))
    file_hash: Mapped[str] = mapped_column(String(64), unique=True)  # prevents duplicate imports
    format: Mapped[str] = mapped_column(String(10))  # csv | json
    records_total: Mapped[int] = mapped_column(default=0)
    records_imported: Mapped[int] = mapped_column(default=0)
    records_failed: Mapped[int] = mapped_column(default=0)
    import_errors: Mapped[list | None] = mapped_column(JSON)
    imported_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
