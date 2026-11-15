"""Static reference data only (anatomical regions). No health data is invented here."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.body_map import BodyRegion

BODY_REGIONS = [
    ("head", "Head"), ("face", "Face"), ("neck", "Neck"),
    ("upper_back", "Upper back"), ("lower_back", "Lower back"),
    ("chest", "Chest"), ("abdomen", "Abdomen"),
    ("arms", "Arms"), ("hands", "Hands"), ("legs", "Legs"), ("feet", "Feet"),
]


def seed_body_regions(session: Session) -> None:
    existing = set(session.scalars(select(BodyRegion.code)))
    for code, name in BODY_REGIONS:
        if code not in existing:
            session.add(BodyRegion(code=code, name=name))
