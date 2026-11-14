from typing import Literal

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories import alert_repo, astronaut_repo
from app.schemas.alert import AcknowledgeRequest, AlertPage, AlertRead
from app.services import alert_service

router = APIRouter(prefix="/alerts", tags=["Alerts"])


@router.get("/{astronaut_id}", response_model=AlertPage)
def list_alerts(
    astronaut_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    alert_status: Literal["open", "acknowledged"] | None = Query(None, alias="status"),
    priority: Literal["low", "medium", "high", "critical"] | None = Query(None),
    db: Session = Depends(get_db),
):
    if astronaut_repo.get(db, astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")
    items, total = alert_repo.list_for_astronaut(db, astronaut_id, skip, limit, alert_status, priority)
    return AlertPage(
        items=items, total=total, skip=skip, limit=limit,
        open_by_priority=alert_repo.open_counts_by_priority(db, astronaut_id),
    )


@router.post("/{alert_id}/acknowledge", response_model=AlertRead)
def acknowledge_alert(
    alert_id: int,
    payload: AcknowledgeRequest = Body(default_factory=AcknowledgeRequest),
    db: Session = Depends(get_db),
):
    """Idempotent: an already-acknowledged alert is returned unchanged."""
    alert, _changed = alert_service.acknowledge(db, alert_id, payload.acknowledged_by)
    return alert
