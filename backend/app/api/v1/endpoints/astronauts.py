from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.repositories import astronaut_repo
from app.schemas.astronaut import AstronautCreate, AstronautRead, AstronautUpdate

router = APIRouter(prefix="/astronauts", tags=["Astronauts"])


@router.post("", response_model=AstronautRead, status_code=status.HTTP_201_CREATED)
def create_astronaut(payload: AstronautCreate, db: Session = Depends(get_db)):
    if astronaut_repo.get_by_crew_code(db, payload.crew_code):
        raise HTTPException(status.HTTP_409_CONFLICT, "crew_code already exists")
    return astronaut_repo.create(db, payload)


@router.get("")
def list_astronauts(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    items, total = astronaut_repo.list_(db, skip, limit)
    return {
        "items": [AstronautRead.model_validate(a) for a in items],
        "total": total,
        "skip": skip,
        "limit": limit,
    }


@router.get("/{astronaut_id}", response_model=AstronautRead)
def get_astronaut(astronaut_id: int, db: Session = Depends(get_db)):
    astronaut = astronaut_repo.get(db, astronaut_id)
    if astronaut is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")
    return astronaut


@router.put("/{astronaut_id}", response_model=AstronautRead)
def update_astronaut(astronaut_id: int, payload: AstronautUpdate, db: Session = Depends(get_db)):
    astronaut = astronaut_repo.get(db, astronaut_id)
    if astronaut is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")
    return astronaut_repo.update(db, astronaut, payload)
