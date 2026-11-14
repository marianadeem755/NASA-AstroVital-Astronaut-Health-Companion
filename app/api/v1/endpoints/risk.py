from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories import astronaut_repo, risk_repo
from app.schemas.risk import AnalyzeResponse, RiskAssessmentRead, RiskHistoryPage
from app.services import risk_service

router = APIRouter(prefix="/risk", tags=["Risk Assessment"])


def _require_astronaut(db: Session, astronaut_id: int) -> None:
    if astronaut_repo.get(db, astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")


@router.post("/analyze/{astronaut_id}", response_model=AnalyzeResponse)
def analyze_risk(astronaut_id: int, db: Session = Depends(get_db)):
    """Run the rule-based engine on the recent observation window and store the result."""
    _require_astronaut(db, astronaut_id)
    return risk_service.analyze_astronaut(db, astronaut_id)


@router.get("/{astronaut_id}", response_model=list[RiskAssessmentRead])
def latest_risk(astronaut_id: int, db: Session = Depends(get_db)):
    """Assessments from the most recent analysis run (empty list if none or no concerns)."""
    _require_astronaut(db, astronaut_id)
    return risk_repo.latest_run(db, astronaut_id)


@router.get("/{astronaut_id}/history", response_model=RiskHistoryPage)
def risk_history(
    astronaut_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    _require_astronaut(db, astronaut_id)
    items, total = risk_repo.history(db, astronaut_id, skip, limit)
    return RiskHistoryPage(items=items, total=total, skip=skip, limit=limit)
