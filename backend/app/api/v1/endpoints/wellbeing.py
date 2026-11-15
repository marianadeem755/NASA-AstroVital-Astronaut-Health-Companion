from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories import astronaut_repo, wellbeing_repo
from app.schemas.observation import to_utc
from app.schemas.wellbeing import (
    MOOD_OPTIONS,
    MoodOptionRead,
    WellbeingCreate,
    WellbeingPage,
    WellbeingRead,
    WellbeingTrendResponse,
)
from app.wellbeing import assessment_service, insight_service

router = APIRouter(prefix="/wellbeing", tags=["Wellbeing"])


def _require_astronaut(db: Session, astronaut_id: int) -> None:
    if astronaut_repo.get(db, astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")


@router.post("/assessment", response_model=WellbeingRead, status_code=status.HTTP_201_CREATED)
def submit_assessment(payload: WellbeingCreate, response: Response, db: Session = Depends(get_db)):
    """Wellbeing scales plus an optional cognitive test, saved together.
    Idempotent: re-sending the same client_uuid returns the stored assessment with 200."""
    _require_astronaut(db, payload.astronaut_id)
    assessment, created = assessment_service.record_assessment(db, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return assessment_service.to_read(assessment)


# Must stay ABOVE the "/{astronaut_id}" routes, or "mood-options" would be read as an astronaut id.
@router.get("/mood-options", response_model=list[MoodOptionRead])
def mood_options():
    """The mood choices to show in the form. Send the chosen "value" as "mood_option" when submitting."""
    return [
        MoodOptionRead(value=key, label=key.replace("_", " ").capitalize(), score=score)
        for key, score in MOOD_OPTIONS.items()
    ]


@router.get("/{astronaut_id}", response_model=WellbeingPage)
def assessment_history(
    astronaut_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    db: Session = Depends(get_db),
):
    _require_astronaut(db, astronaut_id)
    items, total = wellbeing_repo.list_for_astronaut(
        db, astronaut_id, skip, limit, to_utc(start) if start else None, to_utc(end) if end else None
    )
    return WellbeingPage(items=[assessment_service.to_read(a) for a in items], total=total, skip=skip, limit=limit)


@router.get("/{astronaut_id}/trends", response_model=WellbeingTrendResponse)
def assessment_trends(
    astronaut_id: int,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    _require_astronaut(db, astronaut_id)
    return assessment_service.trends_for_astronaut(db, astronaut_id, days)


@router.get("/{astronaut_id}/insight")
def assessment_insight(
    astronaut_id: int,
    days: int = Query(30, ge=7, le=365),
    db: Session = Depends(get_db),
):
    """Deep dive for the Mental Wellbeing page: own usual range, concern runs, cognitive baseline,
    how the scales move together, decline pattern, journal. Read-only; blocks with too few
    check-ins are left out instead of being filled in."""
    return insight_service.get_wellbeing_insight(db, astronaut_id, days)
