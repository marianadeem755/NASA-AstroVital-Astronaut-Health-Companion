from datetime import UTC, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.exercise import ExerciseSession
from app.repositories import astronaut_repo
from app.schemas.observation import to_utc

router = APIRouter(prefix="/exercise", tags=["Exercise"])

Kind = Literal["aerobic", "resistive", "mixed", "other"]


class ExerciseCreate(BaseModel):
    astronaut_id: int = Field(gt=0)
    performed_at: datetime | None = None  # default: now
    minutes: int = Field(ge=1, le=600)
    kind: Kind = "mixed"
    client_uuid: str | None = Field(default=None, min_length=8, max_length=64)

    @field_validator("performed_at")
    @classmethod
    def _not_future(cls, v):
        if v is None:
            return v
        v = to_utc(v)
        if v > datetime.now(UTC) + timedelta(minutes=5):
            raise ValueError("performed_at cannot be in the future")
        return v


class ExerciseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    astronaut_id: int
    performed_at: datetime
    minutes: int
    kind: str
    client_uuid: str | None


@router.post("", response_model=ExerciseRead, status_code=status.HTTP_201_CREATED)
def log_exercise(payload: ExerciseCreate, response: Response, db: Session = Depends(get_db)):
    """Idempotent: re-sending the same client_uuid returns the stored session with 200."""
    if astronaut_repo.get(db, payload.astronaut_id) is None:
        # The app can run on sample files with an empty astronauts table. Create the profile so the session can be saved.
        from app.models.astronaut import Astronaut
        db.add(Astronaut(id=payload.astronaut_id, crew_code=f"AST-{payload.astronaut_id:03d}", full_name=f"Astronaut {payload.astronaut_id}"))
        db.commit()
    if payload.client_uuid:
        existing = db.scalar(select(ExerciseSession).where(ExerciseSession.client_uuid == payload.client_uuid))
        if existing is not None:
            response.status_code = status.HTTP_200_OK
            return existing
    row = ExerciseSession(astronaut_id=payload.astronaut_id, performed_at=payload.performed_at or datetime.now(UTC),
                          minutes=payload.minutes, kind=payload.kind, client_uuid=payload.client_uuid)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.get("/{astronaut_id}", response_model=list[ExerciseRead])
def list_exercise(astronaut_id: int, limit: int = Query(100, ge=1, le=500), db: Session = Depends(get_db)):
    if astronaut_repo.get(db, astronaut_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Astronaut not found")
    return list(db.scalars(select(ExerciseSession).where(ExerciseSession.astronaut_id == astronaut_id)
                           .order_by(ExerciseSession.performed_at.desc(), ExerciseSession.id.desc()).limit(limit)))
