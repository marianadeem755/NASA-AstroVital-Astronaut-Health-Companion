class IngestionError(Exception):
    """The whole file/mapping cannot be processed (nothing is imported)."""


class RowError(Exception):
    """One record is invalid; it is logged and skipped, the import continues.
    record_id is attached when known so the error log can point at the source row."""

    record_id: str | None = None
