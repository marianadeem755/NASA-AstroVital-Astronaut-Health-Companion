from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.body_map import symptom_service
from app.core.database import get_db
from app.core.exceptions import AppError
from app.repositories import astronaut_repo, body_map_repo
from app.schemas.body_map import RegionRead, SymptomCreate, SymptomPage, SymptomRead, TrendResponse
from app.schemas.observation import to_utc

router = APIRouter(prefix="/body-map", tags=["Body Map"])


def _require_astronaut(db: Session, astronaut_id: int) -> None:
    if astronaut_repo.get(db, astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")


@router.get("/regions", response_model=list[RegionRead])
def list_regions(db: Session = Depends(get_db)):
    return body_map_repo.list_regions(db)


@router.post("/symptoms", response_model=SymptomRead, status_code=status.HTTP_201_CREATED)
def report_symptom(payload: SymptomCreate, response: Response, db: Session = Depends(get_db)):
    """Idempotent: re-sending the same client_uuid returns the stored report with 200."""
    _require_astronaut(db, payload.astronaut_id)
    report, created = symptom_service.record_symptom(db, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return report


@router.get("/{astronaut_id}", response_model=SymptomPage)
def symptom_history(
    astronaut_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    region: str | None = Query(None, description="Region code, e.g. lower_back"),
    symptom_type: str | None = Query(None),
    start: datetime | None = Query(None),
    end: datetime | None = Query(None),
    db: Session = Depends(get_db),
):
    _require_astronaut(db, astronaut_id)
    region_id = None
    if region:
        found = body_map_repo.get_region_by_code(db, region.strip().lower())
        if found is None:
            raise AppError(422, f"Unknown body region '{region}'")
        region_id = found.id
    items, total = body_map_repo.list_for_astronaut(
        db, astronaut_id, skip, limit, region_id,
        symptom_type.strip().lower().replace(" ", "_") if symptom_type else None,
        to_utc(start) if start else None, to_utc(end) if end else None,
    )
    return SymptomPage(items=items, total=total, skip=skip, limit=limit)


@router.get("/{astronaut_id}/trends", response_model=TrendResponse)
def symptom_trends(
    astronaut_id: int,
    days: int = Query(30, ge=1, le=365),
    region: str | None = Query(None),
    symptom_type: str | None = Query(None),
    db: Session = Depends(get_db),
):
    _require_astronaut(db, astronaut_id)
    return symptom_service.trends_for_astronaut(
        db, astronaut_id, days,
        region.strip().lower() if region else None,
        symptom_type.strip().lower().replace(" ", "_") if symptom_type else None,
    )
