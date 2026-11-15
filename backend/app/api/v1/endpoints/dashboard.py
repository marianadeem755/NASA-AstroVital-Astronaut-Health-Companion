from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.schemas.dashboard import OverviewResponse, TrendsResponse
from app.services import dashboard_service

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/{astronaut_id}/overview", response_model=OverviewResponse)
def dashboard_overview(astronaut_id: int, db: Session = Depends(get_db)):
    """Current snapshot assembled from stored data. Read-only: never runs analysis."""
    return dashboard_service.overview(db, astronaut_id)


@router.get("/{astronaut_id}/trends", response_model=TrendsResponse)
def dashboard_trends(
    astronaut_id: int,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    """Time series for charts: vitals, wellbeing, cognitive, symptoms and risk history."""
    return dashboard_service.trends(db, astronaut_id, days)
