"""Database access for astronauts. The only layer that talks to SQLAlchemy for this table."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.astronaut import Astronaut
from app.schemas.astronaut import AstronautCreate, AstronautUpdate


def create(db: Session, data: AstronautCreate) -> Astronaut:
    astronaut = Astronaut(**data.model_dump())
    db.add(astronaut)
    db.commit()
    db.refresh(astronaut)
    return astronaut


def get(db: Session, astronaut_id: int) -> Astronaut | None:
    return db.get(Astronaut, astronaut_id)


def get_by_crew_code(db: Session, crew_code: str) -> Astronaut | None:
    return db.scalar(select(Astronaut).where(Astronaut.crew_code == crew_code))


def list_(db: Session, skip: int = 0, limit: int = 50) -> tuple[list[Astronaut], int]:
    total = db.scalar(select(func.count()).select_from(Astronaut)) or 0
    items = db.scalars(select(Astronaut).order_by(Astronaut.id).offset(skip).limit(limit)).all()
    return list(items), total


def update(db: Session, astronaut: Astronaut, data: AstronautUpdate) -> Astronaut:
    for field, value in data.model_dump(exclude_unset=True).items():
        setattr(astronaut, field, value)
    db.commit()
    db.refresh(astronaut)
    return astronaut
