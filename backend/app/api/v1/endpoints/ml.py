"""ML endpoints: data folder -> trained models -> rule flag -> AI recommendations.

The frontend never sends health values. It only picks WHICH data to look at
(a scenario, a subject, or a data id + timepoint) and shows what comes back.
"""
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.ml import data_store, predict
from app.schemas.ml import AlertsInsightRequest, AnalyticsInsightRequest, BoneMuscleRequest, BoneRequest, DayRequest, RadiationRequest, SleepInsightRequest, WellbeingAdviceRequest
from app.services import alerts_advice_service, insights_plan_service, alerts_insight_service, analytics_insight_service, bone_advice_service, bone_muscle_insight_service, llm_service, ml_service, radiation_service, sleep_advice_service, sleep_insight_service, vitals_insight_service, wellbeing_advice_service, wellbeing_insight_service

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


@router.get("/vitals-insight")
def vitals_insight_get(
    scenario_id: Optional[str] = Query(None),
    subject_id: Optional[str] = Query(None),
    mmash_user: Optional[str] = Query(None),
    hrv_user: Optional[str] = Query(None),
    blood_astronaut: Optional[str] = Query(None),
    timepoint: Optional[str] = Query(None),
    exercise_minutes: Optional[float] = Query(None, ge=0, le=1440),
    steps: Optional[int] = Query(None, ge=0, le=200000),
) -> dict[str, Any]:
    """Detailed HRV, blood and activity insights from the selected source records."""
    req = _query_request(
        scenario_id, subject_id, mmash_user, hrv_user, blood_astronaut,
        timepoint, exercise_minutes, steps, "en"
    )
    return vitals_insight_service.get_vitals_insight(req)


@router.post("/vitals-insight")
def vitals_insight_post(payload: DayRequest) -> dict[str, Any]:
    """Same detailed insight endpoint using the frontend's JSON selector payload."""
    return vitals_insight_service.get_vitals_insight(payload)


@router.get("/wellbeing-insight")
def wellbeing_insight_get(
    scenario_id: Optional[str] = Query(None),
    subject_id: Optional[str] = Query(None),
    mmash_user: Optional[str] = Query(None),
) -> dict[str, Any]:
    """Questionnaire scores (stress, anxiety, affect, PSQI) of the selected volunteer against all volunteers,
    mind-body links across the cohort, and the saved stress/sleep model against what was reported."""
    req = _query_request(scenario_id, subject_id, mmash_user, None, None, None, None, None, "en")
    return wellbeing_insight_service.get_wellbeing_insight(req)


@router.post("/wellbeing-insight")
def wellbeing_insight_post(payload: DayRequest) -> dict[str, Any]:
    """Same detailed insight endpoint using the frontend's JSON selector payload."""
    return wellbeing_insight_service.get_wellbeing_insight(payload)


@router.post("/sleep-insight")
def sleep_insight(payload: SleepInsightRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Sleep Tracker deep dive: the astronaut's own nights (sleep debt, runs, regularity, cost of short nights) and one MMASH
    volunteer's measured night against the cohort (profile, perception vs measurement, better-sleeper split, model drivers)."""
    return sleep_insight_service.get_sleep_insight(db, payload)


@router.post("/alerts-insight")
def alerts_insight(payload: AlertsInsightRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Risk Alerts deep dive: alerts raised per factor from the astronaut's own logs, reports and the check-day models, with
    persistence, a compound pattern, a daily timeline and the rule-engine alert queue."""
    return alerts_insight_service.get_alerts_insight(db, payload)


@router.post("/alerts-recommendations")
def alerts_recommendations(payload: AlertsInsightRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """AI recommendations for the Risk Alerts page (Gemini, Grok/Groq fallback). Built server-side from the same alerts."""
    return alerts_advice_service.get_alerts_advice(db, payload)


@router.post("/insights-plan")
def insights_plan(payload: AlertsInsightRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Insights & Actions plan built from the same factor alerts as the Risk Alerts page: steps for today, this week and the
    medical conference, where the pressure comes from, and the links between factors."""
    return insights_plan_service.get_insights_plan(db, payload)


@router.post("/insights-recommendations")
def insights_recommendations(payload: AlertsInsightRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """AI-written action plan for the Insights & Actions page (Gemini, Grok/Groq fallback). Built server-side from the same alerts."""
    return insights_plan_service.get_insights_advice(db, payload)


@router.post("/analytics-insight")
def analytics_insight(payload: AnalyticsInsightRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Trends & Analytics deep dive: logged-data trends, relations between measures, risk and alert history, blood across the
    whole crew and a scorecard of every saved model."""
    return analytics_insight_service.get_analytics_insight(db, payload)


@router.post("/bone-muscle-insight")
def bone_muscle_insight(payload: BoneMuscleRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """Bone & Muscle deep dive: the bone-risk model opened up (reference table, drivers, levers, curves, reliability),
    the astronaut's logged exercise, musculoskeletal symptom reports, and published reference values."""
    return bone_muscle_insight_service.get_bone_muscle_insight(db, payload)


@router.post("/bone-recommendations")
def bone_recommendations(payload: BoneMuscleRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """AI recommendations for the Bone & Muscle calculator (Gemini, Grok/Groq fallback). Built server-side from the data."""
    return bone_advice_service.get_bone_advice(db, payload)


@router.post("/sleep-recommendations")
def sleep_recommendations(payload: SleepInsightRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """AI recommendations for the Sleep Tracker page (Gemini, Grok/Groq fallback). Built server-side from the data."""
    return sleep_advice_service.get_sleep_advice(db, payload)


@router.post("/wellbeing-recommendations")
def wellbeing_recommendations(payload: WellbeingAdviceRequest, db: Session = Depends(get_db)) -> dict[str, Any]:
    """AI recommendations for the Mental Wellbeing page (Gemini, Grok/Groq fallback). Built server-side from the data."""
    return wellbeing_advice_service.get_wellbeing_advice(db, payload)


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


@router.post("/radiation-recommendations")
def radiation_recommendations(payload: RadiationRequest) -> dict[str, Any]:
    """AI recommendations for the Radiation Monitor page (Gemini, Grok fallback)."""
    return radiation_service.get_radiation_advice(payload)


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