from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories import astronaut_repo, recommendation_repo
from app.schemas.recommendation import (
    EvaluateRequest,
    EvaluateResponse,
    ProtocolRead,
    RecommendationPage,
)
from app.services import recommendation_service

router = APIRouter(prefix="/recommendations", tags=["Recommendations"])


@router.post("/evaluate", response_model=EvaluateResponse)
def evaluate_recommendations(payload: EvaluateRequest, db: Session = Depends(get_db)):
    """Match current risk findings and reported symptoms against approved protocols."""
    if astronaut_repo.get(db, payload.astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")
    return recommendation_service.evaluate(db, payload)


# Declared before "/{astronaut_id}" so "protocols" is never read as an id.
@router.get("/protocols", response_model=list[ProtocolRead])
def list_protocols(
    active_only: bool = Query(True, description="Only protocols approved for use"),
    db: Session = Depends(get_db),
):
    return recommendation_repo.list_protocols(db, active_only=active_only)


@router.get("/{astronaut_id}", response_model=RecommendationPage)
def recommendation_history(
    astronaut_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    if astronaut_repo.get(db, astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")
    items, total = recommendation_repo.history(db, astronaut_id, skip, limit)
    return RecommendationPage(items=items, total=total, skip=skip, limit=limit)
