from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models.alert import Alert
from app.repositories import alert_repo


def acknowledge(db: Session, alert_id: int, acknowledged_by: str | None) -> tuple[Alert, bool]:
    """Returns (alert, changed). Acknowledging twice is a no-op that keeps the ORIGINAL
    acknowledgement time and person, so the audit trail cannot be overwritten."""
    alert = alert_repo.get(db, alert_id)
    if alert is None:
        raise AppError(404, "Alert not found")
    if alert.status == "acknowledged":
        return alert, False
    alert.status = "acknowledged"
    alert.acknowledged_at = datetime.now(UTC)
    alert.acknowledged_by = acknowledged_by
    db.commit()
    db.refresh(alert)
    return alert, True
