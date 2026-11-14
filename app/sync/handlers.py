"""Per-entity behaviour for sync: how to validate, apply, and find a same-moment record.
Adding a new syncable entity = adding one Handler here."""
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.body_map import symptom_service
from app.models.body_map import SymptomReport
from app.models.observation import Observation
from app.models.wellbeing import WellbeingAssessment
from app.repositories import body_map_repo, observation_repo
from app.schemas.body_map import SymptomCreate
from app.schemas.observation import METRIC_FIELDS, ObservationCreate, to_utc
from app.schemas.wellbeing import WellbeingCreate
from app.wellbeing import assessment_service


@dataclass(frozen=True)
class Handler:
    schema: type[BaseModel]
    apply: Callable[[Session, Any], tuple[Any, bool]]       # -> (row, created)
    find_same_moment: Callable[[Session, Any], Any | None]  # existing row for same astronaut+time
    compare_fields: tuple[str, ...]                          # values that must match to be "the same"
    snapshot: Callable[[Any], dict]


def _iso(value) -> str:
    return to_utc(value).isoformat()


# ---- observation ---------------------------------------------------------------------
def _find_observation(db: Session, data: ObservationCreate):
    return db.scalar(
        select(Observation).where(
            Observation.astronaut_id == data.astronaut_id, Observation.observed_at == data.observed_at
        )
    )


def _snap_observation(o: Observation) -> dict:
    return {"id": o.id, "client_uuid": o.client_uuid, "observed_at": _iso(o.observed_at),
            **{f: getattr(o, f) for f in METRIC_FIELDS}}


# ---- symptom -------------------------------------------------------------------------
def _find_symptom(db: Session, data: SymptomCreate):
    if data.reported_at is None:  # server-assigned time can never collide
        return None
    region = body_map_repo.get_region_by_code(db, data.region_code)
    if region is None:
        return None  # apply() will report the unknown region
    return db.scalar(
        select(SymptomReport).where(
            SymptomReport.astronaut_id == data.astronaut_id,
            SymptomReport.body_region_id == region.id,
            SymptomReport.symptom_type == data.symptom_type,
            SymptomReport.reported_at == data.reported_at,
        )
    )


def _snap_symptom(s: SymptomReport) -> dict:
    return {"id": s.id, "client_uuid": s.client_uuid, "reported_at": _iso(s.reported_at),
            "region_code": s.region_code, "symptom_type": s.symptom_type,
            "severity": s.severity, "duration_minutes": s.duration_minutes}


# ---- wellbeing -----------------------------------------------------------------------
def _find_wellbeing(db: Session, data: WellbeingCreate):
    if data.assessed_at is None:
        return None
    return db.scalar(
        select(WellbeingAssessment).where(
            WellbeingAssessment.astronaut_id == data.astronaut_id,
            WellbeingAssessment.assessed_at == data.assessed_at,
        )
    )


def _snap_wellbeing(w: WellbeingAssessment) -> dict:
    return {"id": w.id, "client_uuid": w.client_uuid, "assessed_at": _iso(w.assessed_at),
            "sleep_quality": w.sleep_quality, "mood": w.mood, "stress": w.stress, "fatigue": w.fatigue}


HANDLERS: dict[str, Handler] = {
    "observation": Handler(
        ObservationCreate, observation_repo.create, _find_observation,
        tuple(METRIC_FIELDS), _snap_observation,
    ),
    "symptom": Handler(
        SymptomCreate, symptom_service.record_symptom, _find_symptom,
        ("severity", "duration_minutes"), _snap_symptom,
    ),
    "wellbeing": Handler(
        WellbeingCreate, assessment_service.record_assessment, _find_wellbeing,
        ("sleep_quality", "mood", "stress", "fatigue"), _snap_wellbeing,
    ),
}


def differs(handler: Handler, existing: Any, data: BaseModel) -> bool:
    return any(getattr(existing, f) != getattr(data, f) for f in handler.compare_fields)
