"""Runs one full AstroVital day: data folder -> trained models -> rule flag
-> (optional) AI recommendations. Pure orchestration, no database."""
import json
from pathlib import Path

from app.core.config import settings
from app.core.exceptions import AppError
from app.ml import data_store, predict
from app.schemas.ml import DayRequest
from app.services import llm_service

# What no file / model in the project can measure (from TEAM_HANDOFF.md).
# Sent to the AI so it never invents these.
NOT_MEASURABLE = [
    "Oxygen saturation (SpO2): no data",
    "Radiation dose: no data",
    "Mood and energy: no daily data",
    "Fluid shift (puffy face, back pain): no model measures it directly",
    "Muscle loss and bone change in space: no human data",
]

# Which saved model produced which score (for the reliability list).
SCORE_TO_MODEL = {
    "P_poor_sleep": "sleep_poor_logreg",
    "predicted_daily_stress": "stress_ridge",
    "hrv_anomaly_frac": "hrv_anomaly_isoforest",
    "P_R+1_like_insp4_blood": "insp4_postflight_logreg",
    "P_R+1_like_osd571_blood": "osd571_postflight_pca_logreg",
}
BONE_MODEL = "nhanes_bone_risk"

_DEFAULT_FIELDS = ["mmash_user", "hrv_user", "blood_astronaut", "timepoint",
                   "exercise_minutes", "steps", "bone_profile"]


def _read_json(name):
    p = Path(settings.models_dir) / name
    if not p.exists():
        return {}
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def model_registry():
    """metadata + metrics for every model, merged, straight from the model files."""
    meta, metrics = _read_json("model_metadata.json"), _read_json("metrics.json")
    loaded = predict.load_models()
    out = []
    for name in predict.MODEL_NAMES:
        m = meta.get(name, {})
        out.append({
            "model": name,
            "loaded": name in loaded,
            "predicts": m.get("predicts"),
            "population": m.get("population"),
            "status": m.get("status"),
            "validation": m.get("validation"),
            "metrics": m.get("metrics"),
            "warning": (metrics.get(name) or {}).get("warning"),
            "used_in_check_day": name in SCORE_TO_MODEL.values(),
            "separate_call": name == BONE_MODEL,
        })
    return out


def _merge_defaults(req: DayRequest):
    """request fields > scenario > subject. Returns a plain dict."""
    chosen = {k: None for k in _DEFAULT_FIELDS}
    subject = scenario = None
    if req.subject_id:
        subject = data_store.get_subject(req.subject_id)
        if subject is None:
            raise AppError(404, f"subject_id '{req.subject_id}' not found in crew_map.json")
        chosen.update({k: subject.get(k) for k in _DEFAULT_FIELDS if subject.get(k) is not None})
    if req.scenario_id:
        scenario = data_store.get_scenario(req.scenario_id)
        if scenario is None:
            raise AppError(404, f"scenario_id '{req.scenario_id}' not found in crew_map.json")
        if scenario.get("subject_id") and not subject:
            subject = data_store.get_subject(scenario["subject_id"])
            if subject:
                chosen.update({k: subject.get(k) for k in _DEFAULT_FIELDS if subject.get(k) is not None})
        chosen.update({k: scenario.get(k) for k in _DEFAULT_FIELDS if scenario.get(k) is not None})
    body = req.model_dump(exclude_none=True)
    for k in _DEFAULT_FIELDS:
        if k in body:
            chosen[k] = body[k]
    return chosen, subject, scenario


def _rows_from_data(chosen):
    """Resolve selectors and pull the rows. Unknown ids -> 404 with a clear message."""
    try:
        mmash_user = data_store.resolve_mmash_user(chosen["mmash_user"])
        hrv_user = data_store.resolve_hrv_user(chosen["hrv_user"])
        mrow = data_store.mmash_row(mmash_user)
        if chosen["mmash_user"] and mrow is None:
            raise AppError(404, f"mmash_user '{mmash_user}' not found. Try one of: {data_store.mmash_users()}")
        windows = data_store.hrv_windows(hrv_user)
        if chosen["hrv_user"] and windows is None:
            raise AppError(404, f"No eligible HRV windows for '{hrv_user}'. Try one of: {data_store.hrv_users()}")
        insp, osd = data_store.blood_rows(chosen["blood_astronaut"], chosen["timepoint"])
        if chosen["blood_astronaut"] and chosen["timepoint"] and insp is None and osd is None:
            raise AppError(404, f"No blood sample for {chosen['blood_astronaut']} at {chosen['timepoint']}. "
                                f"Timepoints: {data_store.blood_timepoints(chosen['blood_astronaut'])}")
    except data_store.DataNotFound as exc:
        raise AppError(404, f"Data file missing: {exc}") from exc
    except FileNotFoundError as exc:
        raise AppError(503, str(exc)) from exc
    return mmash_user, hrv_user, mrow, windows, insp, osd


def _provenance(chosen, mmash_user, hrv_user, insp, osd, windows):
    prov = []
    if mmash_user:
        prov.append(f"Sleep/stress model input: MMASH volunteer {mmash_user} (Earth volunteers, not astronauts)")
    if hrv_user and windows is not None:
        prov.append(f"HRV: {len(windows)} windows of MMASH volunteer {hrv_user} (Earth volunteers, not astronauts)")
    if insp is not None or osd is not None:
        prov.append(f"Blood/metabolomics: Inspiration4 crew {chosen['blood_astronaut']} at {chosen['timepoint']}")
    if chosen.get("bone_profile"):
        prov.append("Bone risk: model trained on US adults 40-80 (NHANES), not astronauts")
    return prov


def run_day(req: DayRequest, with_ai=False):
    chosen, subject, scenario = _merge_defaults(req)
    mmash_user, hrv_user, mrow, windows, insp, osd = _rows_from_data(chosen)

    steps = chosen["steps"] if chosen["steps"] is not None else data_store.steps_per_day(mrow)
    try:
        day = predict.check_day(
            mmash_row=mrow, hrv_windows=windows, insp4_row=insp, osd571_row=osd,
            steps=steps, exercise_minutes=chosen["exercise_minutes"],
        )
        bone = None
        profile = chosen["bone_profile"]  # always a dict (request body or crew_map.json)
        if profile:
            bone = predict.predict_bone(profile)
    except FileNotFoundError as exc:
        raise AppError(503, str(exc)) from exc

    baseline = data_store.baseline_changes(chosen["blood_astronaut"], chosen["timepoint"])
    registry = {m["model"]: m for m in model_registry()}
    used = [SCORE_TO_MODEL[k] for k in day.get("scores", {}) if k in SCORE_TO_MODEL]
    if bone:
        used.append(BONE_MODEL)
    reliability = [
        {"model": n, "predicts": registry[n]["predicts"], "population": registry[n]["population"],
         "status": registry[n]["status"], "metrics": registry[n]["metrics"]}
        for n in dict.fromkeys(used) if n in registry
    ]

    warnings = []
    age = profile.get("age") if profile else None
    if bone and age is not None and not (40 <= age <= 80):
        warnings.append("Bone model was trained on ages 40-80; this age is outside that range.")
    if (mmash_user or hrv_user) and (insp is not None or osd is not None):
        warnings.append("This day combines separate datasets (MMASH volunteers + Inspiration4 crew). "
                        "It is a demo composite, not one person's real day.")
    if not bone:
        warnings.append("No bone profile for this subject: bone risk not computed.")

    result = {
        "level": day["level"],
        "subject": {"subject_id": (subject or {}).get("subject_id"), "display_name": (subject or {}).get("display_name"),
                    "scenario_id": (scenario or {}).get("scenario_id")},
        "inputs_used": {
            "mmash_user": mmash_user, "hrv_user": hrv_user,
            "hrv_windows_checked": None if windows is None else int(len(windows)),
            "blood_astronaut": chosen["blood_astronaut"], "timepoint": chosen["timepoint"],
            "exercise_minutes": chosen["exercise_minutes"], "steps": steps,
        },
        "check_day": day,
        "bone_risk": bone,
        "baseline_changes": baseline,
        "model_reliability": reliability,
        "not_measurable": NOT_MEASURABLE,
        "data_provenance": _provenance(chosen, mmash_user, hrv_user, insp, osd, windows),
        "warnings": warnings,
        "ai": None,
        "disclaimer": "Demo only, not medical advice.",
    }

    if with_ai:
        context = {
            "level": day["level"], "flags": day["flags"], "n_strong_flags": day["n_strong_flags"],
            "n_weak_flags": day["n_weak_flags"], "missing": day["missing"], "scores": day.get("scores", {}),
            "rule_recommendations": day["recommendations"],
            "bone_risk": None if not bone else {k: bone[k] for k in ("bone_risk_label", "probabilities", "inputs_missing")},
            "blood_timepoint": chosen["timepoint"],
            "baseline_changes_vs_own_preflight": baseline,
            "model_reliability": reliability,
            "not_measurable": NOT_MEASURABLE,
            "data_provenance": result["data_provenance"],
            "warnings": warnings,
        }
        try:
            result["ai"] = llm_service.generate(context, req.language)
        except llm_service.LLMUnavailable as exc:
            result["ai"] = {"source": "rules_only", "model": None, "cached": False, "attempts": [],
                            "error": str(exc), "result": None}
    return result


def run_bone(profile):
    try:
        return predict.predict_bone(profile.model_dump())
    except FileNotFoundError as exc:
        raise AppError(503, str(exc)) from exc


def list_subjects():
    cm = data_store.crew_map()
    try:
        astronauts = {a: data_store.blood_timepoints(a) for a in data_store.blood_astronauts()}
    except data_store.DataNotFound:
        astronauts = {}
    try:
        users = data_store.mmash_users()
        hrv_users = data_store.hrv_users()
    except data_store.DataNotFound:
        users, hrv_users = [], []
    return {
        "subjects": cm["subjects"], "scenarios": cm["scenarios"],
        "blood_astronauts": astronauts, "mmash_users": users, "hrv_users": hrv_users,
        "selectors": {"mmash_user": ["auto:good", "auto:poor"], "hrv_user": ["auto:normal", "auto:anomalous"]},
    }
