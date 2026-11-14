from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories import astronaut_repo, observation_repo
from app.schemas.observation import (
    BulkItemResult,
    BulkObservationRequest,
    BulkObservationResponse,
    ObservationCreate,
    ObservationPage,
    ObservationRead,
    to_utc,
)

router = APIRouter(prefix="/observations", tags=["Observations"])


def _require_astronaut(db: Session, astronaut_id: int) -> None:
    if astronaut_repo.get(db, astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")


@router.post("", response_model=ObservationRead, status_code=status.HTTP_201_CREATED)
def create_observation(payload: ObservationCreate, response: Response, db: Session = Depends(get_db)):
    """Idempotent: re-sending the same client_uuid returns the stored record with 200."""
    _require_astronaut(db, payload.astronaut_id)
    obs, created = observation_repo.create(db, payload)
    if not created:
        response.status_code = status.HTTP_200_OK
    return obs


@router.post("/bulk", response_model=BulkObservationResponse)
def create_observations_bulk(payload: BulkObservationRequest, db: Session = Depends(get_db)):
    """Per-item results, so an offline queue can be replayed safely."""
    known: dict[int, bool] = {}
    results: list[BulkItemResult] = []
    for index, item in enumerate(payload.observations):
        if item.astronaut_id not in known:
            known[item.astronaut_id] = astronaut_repo.get(db, item.astronaut_id) is not None
        if not known[item.astronaut_id]:
            results.append(BulkItemResult(index=index, status="rejected", detail="Astronaut not found"))
            continue
        obs, created = observation_repo.create(db, item)
        results.append(
            BulkItemResult(
                index=index, status="created" if created else "duplicate", observation_id=obs.id
            )
        )
    count = lambda s: sum(r.status == s for r in results)  # noqa: E731
    return BulkObservationResponse(
        created=count("created"), duplicates=count("duplicate"), rejected=count("rejected"),
        results=results,
    )


@router.get("/{astronaut_id}", response_model=ObservationPage)
def list_observations(
    astronaut_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
    start: datetime | None = Query(None, description="Only observations at/after this time"),
    end: datetime | None = Query(None, description="Only observations at/before this time"),
    db: Session = Depends(get_db),
):
    _require_astronaut(db, astronaut_id)
    items, total = observation_repo.list_for_astronaut(
        db, astronaut_id, skip, limit,
        to_utc(start) if start else None, to_utc(end) if end else None,
    )
    return ObservationPage(items=items, total=total, skip=skip, limit=limit)


@router.get("/{astronaut_id}/latest", response_model=ObservationRead)
def latest_observation(astronaut_id: int, db: Session = Depends(get_db)):
    _require_astronaut(db, astronaut_id)
    obs = observation_repo.latest_for_astronaut(db, astronaut_id)
    if obs is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No observations recorded")
    return obs
