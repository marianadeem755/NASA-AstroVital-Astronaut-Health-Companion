"""ML endpoints: data folder -> trained models -> rule flag -> AI recommendations.

The frontend never sends health values. It only picks WHICH data to look at
(a scenario, a subject, or a data id + timepoint) and shows what comes back.
"""
from typing import Any, Literal, Optional

from fastapi import APIRouter, HTTPException, Query, status

from app.core.config import settings
from app.ml import data_store, predict
from app.schemas.ml import BoneRequest, DayRequest
from app.services import llm_service, ml_service

router = APIRouter(prefix="/ml", tags=["ML + AI recommendations"])


def _query_request(scenario_id, subject_id, mmash_user, hrv_user, blood_astronaut, timepoint,
                   exercise_minutes, steps, language) -> DayRequest:
    return DayRequest(scenario_id=scenario_id, subject_id=subject_id, mmash_user=mmash_user,
                      hrv_user=hrv_user, blood_astronaut=blood_astronaut, timepoint=timepoint,
                      exercise_minutes=exercise_minutes, steps=steps, language=language)


@router.get("/status")
def ml_status() -> dict[str, Any]:
    """What is loaded: models, data files found, AI providers (no keys shown)."""
    models = predict.load_models()
    return {
        "models_dir": str(settings.models_dir),
        "models_loaded": sorted(models.keys()),
        "models_missing": [m for m in predict.MODEL_NAMES if m not in models],
        "data_dir": str(settings.data_dir),
        "data_files": data_store.available_files(),
        "ai_providers": llm_service.status(),
    }


@router.get("/models")
def list_models() -> list[dict[str, Any]]:
    """Every model: what it predicts, population, honest status, metrics."""
    return ml_service.model_registry()


@router.get("/subjects")
def list_subjects() -> dict[str, Any]:
    """Everything the frontend can pick from: subjects, scenarios, blood timepoints, MMASH users."""
    return ml_service.list_subjects()


@router.get("/scenarios")
def list_scenarios() -> list[dict[str, Any]]:
    return data_store.crew_map()["scenarios"]


@router.get("/demo-results")
def demo_results() -> dict[str, Any]:
    """The team's 5 saved example outputs (models/demo_results.json), for frontend testing."""
    import json
    p = settings.models_dir / "demo_results.json"
    if not p.exists():
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"{p.name} not found in {settings.models_dir}")
    return json.loads(p.read_text(encoding="utf-8"))


@router.get("/check-day")
def check_day_get(
    scenario_id: Optional[str] = Query(None, description="e.g. B_R+1_bad_day (from crew_map.json)"),
    subject_id: Optional[str] = Query(None),
    mmash_user: Optional[str] = Query(None, description="user_1.. or auto:good / auto:poor"),
    hrv_user: Optional[str] = Query(None, description="user_1.. or auto:normal / auto:anomalous"),
    blood_astronaut: Optional[str] = Query(None, description="C001..C004"),
    timepoint: Optional[str] = Query(None, description="L-3, R+1, R+45 ..."),
    exercise_minutes: Optional[float] = Query(None, ge=0, le=1440),
    steps: Optional[int] = Query(None, ge=0, le=200000),
) -> dict[str, Any]:
    """Models + rule flag only (fast, uses no AI quota)."""
    req = _query_request(scenario_id, subject_id, mmash_user, hrv_user, blood_astronaut, timepoint,
                         exercise_minutes, steps, "en")
    return ml_service.run_day(req, with_ai=False)


@router.post("/check-day")
def check_day_post(payload: DayRequest) -> dict[str, Any]:
    """Same as GET, JSON body (also accepts a bone_profile)."""
    return ml_service.run_day(payload, with_ai=False)


@router.get("/recommendations")
def recommendations_get(
    scenario_id: Optional[str] = Query(None),
    subject_id: Optional[str] = Query(None),
    mmash_user: Optional[str] = Query(None),
    hrv_user: Optional[str] = Query(None),
    blood_astronaut: Optional[str] = Query(None),
    timepoint: Optional[str] = Query(None),
    exercise_minutes: Optional[float] = Query(None, ge=0, le=1440),
    steps: Optional[int] = Query(None, ge=0, le=200000),
    language: Literal["en", "roman-urdu"] = Query("en"),
) -> dict[str, Any]:
    """Full day: models + rule flag + AI recommendations (Gemini, Grok fallback)."""
    req = _query_request(scenario_id, subject_id, mmash_user, hrv_user, blood_astronaut, timepoint,
                         exercise_minutes, steps, language)
    return ml_service.run_day(req, with_ai=True)


@router.post("/recommendations")
def recommendations_post(payload: DayRequest) -> dict[str, Any]:
    """Same as GET, JSON body (also accepts a bone_profile and language)."""
    return ml_service.run_day(payload, with_ai=True)


@router.post("/bone-risk")
def bone_risk(payload: BoneRequest) -> dict[str, Any]:
    """Bone risk Low/Medium/High (screening only, NHANES model)."""
    return ml_service.run_bone(payload.bone_profile)


@router.post("/reload")
def reload_data() -> dict[str, Any]:
    """Re-read the data folder and the model files (after you drop in new files)."""
    data_store.clear_cache()
    predict.load_models(force=True)
    return ml_status()
