"""
AstroVital - use the trained models: one combined daily flag.
===============================================================
This is Step 4 (risk detection) + Step 5 (recommendations) of the
AstroVital plan, built on the separate models trained in train_all.py.

How it works (separate models, combined only by simple rules):
  Physical Health   -> HRV anomaly model + Inspiration4 / OSD-571 blood models
  Mental Wellbeing  -> poor-sleep model + daily-stress model (both WEAK, see below)
  Bone & Muscle     -> NO trained model in these files. Only a manual
                       exercise proxy (steps / exercise minutes).

  green = no flag on.  amber = 1 flag on.  red = 2 or more flags on,
  or 1 strong flag + 1 weak flag. A red that comes only from the two
  weak models is shown as amber, with the reason written in the output.

  Strong evidence: HRV anomaly, blood post-flight-like.
  Weak evidence:   poor sleep, high stress. Both MMASH merged models
  did NOT beat chance (sleep AUC 0.47, stress R2 -1.00, n=21), so
  their flags are shown as "weak" and never trigger red on their own.

Use it from the frontend (Maria) or from a notebook:
  from app.ml.predict import astrovital_flag, load_models
  result = astrovital_flag(sleep_proba=0.2, stress=28,
                           hrv_anomaly_frac=0.04, blood_proba=0.12,
                           steps=9000, exercise_minutes=45)
  result["level"]          # "green" / "amber" / "red"
  result["flags"]          # list of plain-language flags
  result["recommendations"]# list of next steps
  result["missing"]        # domains with no data for this check

Or give it real rows and let it call the models for you:
  from app.ml.predict import check_day
  check_day(mmash_row, hrv_windows, insp4_blood_row, osd571_blood_row)

This is a demo, not medical advice. No single model here should
trigger a medical decision on its own. Red means: tell the mission
medical officer today.
"""

import threading

import joblib
import pandas as pd

from app.core.config import settings

# Backend copy of the team's predict.py (AstroVital_Team_Handoff).
# Thresholds and flag rules are UNCHANGED. Only changes: models folder comes
# from settings, all 7 models load, and predict_bone() was added (card 07).
MODELS_DIR = settings.models_dir

MODEL_NAMES = [
    "sleep_poor_logreg", "stress_ridge", "hrv_anomaly_isoforest",
    "insp4_postflight_logreg", "osd571_postflight_pca_logreg",
    "glds431_pca", "nhanes_bone_risk",
]

_MODELS = {}
_LOCK = threading.Lock()


def load_models(force=False):
    """Load the saved .pkl models once, return a dict {name: pipeline}."""
    with _LOCK:
        if force:
            _MODELS.clear()
        if _MODELS:
            return _MODELS
        for name in MODEL_NAMES:
            p = MODELS_DIR / f"{name}.pkl"
            if p.exists():
                _MODELS[name] = joblib.load(p)
    return _MODELS


def require_model(name):
    models = load_models()
    if name not in models:
        raise FileNotFoundError(
            f"Model file {name}.pkl not found in {MODELS_DIR}. "
            "Copy the 7 .pkl files from AstroVital_Team_Handoff/models/ into that folder."
        )
    return models[name]


def _features(model):
    """Column names a saved Pipeline was trained on, in order."""
    names = getattr(model, "feature_names_in_", None)
    return list(names) if names is not None else None


def predict_sleep(row):
    """P(poor sleep) from one MMASH merged row (DataFrame, 1 row).

    Data: MMASH_sleep_summary.csv + MMASH_psychological_scores.csv
    + MMASH_activity_summary_quality_reviewed.csv + HRV means from
    MMASH_RR_HRV_final_all_windows__1.csv. WEAK model, see module docstring.
    """
    m = require_model("sleep_poor_logreg")
    cols = _features(m)
    return float(m.predict_proba(row[cols])[:, 1][0])


def predict_stress(row):
    """Predicted Daily_stress from one MMASH merged row (DataFrame, 1 row).

    Data: same MMASH merged files as predict_sleep. WEAK model.
    """
    m = require_model("stress_ridge")
    cols = _features(m)
    return float(m.predict(row[cols])[0])


def predict_hrv(windows):
    """Fraction of HRV windows flagged unusual (-1).

    Data: MMASH_RR_HRV_final_all_windows__1.csv.
    windows: DataFrame with mean_hr_bpm, rr_sdnn_ms, rr_rmssd_ms,
    rr_pnn50_percent. Returns (fraction_flagged, n_windows).
    """
    m = require_model("hrv_anomaly_isoforest")
    cols = _features(m)
    pred = m.predict(windows[cols])
    return float((pred == -1).mean()), int(len(pred))


def predict_blood_insp4(row):
    """P(R+1-like blood) from one Inspiration4 blood row (DataFrame, 1 row).

    Data: Inspiration4_integrated_serum_CBC_metabolomics.csv,
    CMP + CBC value columns only (39 features).
    """
    m = require_model("insp4_postflight_logreg")
    cols = _features(m)
    return float(m.predict_proba(row[cols])[:, 1][0])


def predict_blood_osd571(row):
    """P(R+1-like blood) from one OSD-571 metabolomics row (DataFrame, 1 row).

    Data: OSD-571_ANP_RP_metabolomics_combined.csv, 680 metabolites.
    """
    m = require_model("osd571_postflight_pca_logreg")
    cols = _features(m)
    return float(m.predict_proba(row[cols])[:, 1][0])


def baseline_change(baseline_values, current_value):
    """Step 3 of the plan: % change of one value vs personal baseline.

    baseline_values: the person's own pre-flight values (e.g. L-92,
    L-44, L-3). Returns % change, rounded. Positive = higher than baseline.
    """
    base = float(pd.Series(baseline_values).mean())
    if base == 0:
        return None
    return round((float(current_value) - base) / abs(base) * 100, 1)


def astrovital_flag(sleep_proba=None, stress=None, hrv_anomaly_frac=None,
                    blood_proba=None, steps=None, exercise_minutes=None):
    """Combine the separate model outputs into one green / amber / red flag.

    Give only what you have; anything left as None is listed under
    "missing" instead of being guessed. Thresholds are written out
    here so the team and the judges can read them.
    """
    flags, weak_flags, strong_flags, missing = [], [], [], []

    if sleep_proba is None:
        missing.append("sleep (no MMASH row for this person/day)")
    elif sleep_proba > 0.5:
        flags.append(f"Poor sleep likely (P={sleep_proba:.2f}) [weak evidence]")
        weak_flags.append("sleep")

    if stress is None:
        missing.append("stress (no Daily_stress for this person/day)")
    elif stress > 50:
        flags.append(f"High stress (Daily_stress={stress:.0f}, over 50) [weak evidence]")
        weak_flags.append("stress")

    if hrv_anomaly_frac is None:
        missing.append("HRV (no HRV windows for this check)")
    elif hrv_anomaly_frac > 0.10:
        flags.append(f"Unusual HRV in {hrv_anomaly_frac:.0%} of windows (over 10%) [strong evidence]")
        strong_flags.append("hrv")

    if blood_proba is None:
        missing.append("blood (no blood sample for this check)")
    elif blood_proba > 0.5:
        flags.append(f"Blood looks post-flight-like (P={blood_proba:.2f}) [strong evidence]")
        strong_flags.append("blood")

    # Bone & Muscle: no trained model. Manual proxy only.
    # If exercise minutes were logged, they decide. Steps are only
    # used when no exercise minutes were logged.
    if exercise_minutes is not None:
        if exercise_minutes < 20:
            flags.append("Low exercise today (proxy only, no trained bone/muscle model)")
            weak_flags.append("exercise")
    elif steps is not None:
        if steps < 5000:
            flags.append("Low exercise today (proxy only, no trained bone/muscle model)")
            weak_flags.append("exercise")
    else:
        missing.append("bone/muscle (no exercise data, and no trained model exists for it)")

    # No data at all is not green, it is unknown.
    if (sleep_proba is None and stress is None and hrv_anomaly_frac is None
            and blood_proba is None and steps is None and exercise_minutes is None):
        return {
            "level": "unknown",
            "flags": [],
            "n_strong_flags": 0,
            "n_weak_flags": 0,
            "missing": missing,
            "recommendations": ["No data for this check. Log sleep, stress, HRV, blood, or exercise first."],
            "note": "Demo only, not medical advice. Sleep and stress flags are weak evidence (see metrics.json). Bone/muscle has no trained model.",
        }

    n_strong, n_weak = len(strong_flags), len(weak_flags)
    if n_strong >= 2 or (n_strong >= 1 and n_weak >= 1):
        level = "red"
    elif n_strong >= 1 or n_weak >= 2:
        level = "amber"
    elif n_weak == 1:
        level = "amber"
    else:
        level = "green"
    if level == "red" and n_strong == 0:
        level = "amber"  # weak evidence alone never makes red

    recommendations = []
    if level == "green":
        recommendations.append("No flag. Keep the normal schedule and log tomorrow as usual.")
    if "sleep" in weak_flags:
        recommendations.append("Sleep: keep a regular sleep window, dark and quiet, no caffeine late, check again tomorrow.")
    if "stress" in weak_flags:
        recommendations.append("Stress: guided breathing, a short journal note, and a short break or a talk with a crewmate.")
    if "hrv" in strong_flags:
        recommendations.append("HRV: rest today, light exercise only, re-check the next HRV window. Tell the medical officer if it stays unusual.")
    if "blood" in strong_flags:
        recommendations.append("Blood: rest, drink water, tell the mission medical officer, and re-check bloods when scheduled.")
    if "exercise" in weak_flags:
        recommendations.append("Exercise: do the scheduled countermeasure exercise and log it, so bone and muscle stay loaded.")
    if level == "red":
        recommendations.append("RED: contact the mission medical officer today. Do not do hard training until they say so.")
    if level == "amber":
        recommendations.append("AMBER: take the steps above and check again tomorrow. Tell the medical officer if a second flag appears.")

    return {
        "level": level,
        "flags": flags,
        "n_strong_flags": n_strong,
        "n_weak_flags": n_weak,
        "missing": missing,
        "recommendations": recommendations,
        "note": "Demo only, not medical advice. Sleep and stress flags are weak evidence (see metrics.json). Bone/muscle has no trained model.",
    }


def check_day(mmash_row=None, hrv_windows=None, insp4_row=None,
              osd571_row=None, steps=None, exercise_minutes=None):
    """One call for a whole day: run every model you have rows for,
    then combine them with astrovital_flag. Returns the flag dict
    plus the raw model numbers under 'scores'."""
    scores = {}
    if mmash_row is not None:
        scores["P_poor_sleep"] = round(predict_sleep(mmash_row), 2)
        scores["predicted_daily_stress"] = round(predict_stress(mmash_row), 1)
    if hrv_windows is not None:
        frac, n = predict_hrv(hrv_windows)
        scores["hrv_anomaly_frac"] = round(frac, 3)
        scores["hrv_windows_checked"] = n
    blood = []
    if insp4_row is not None:
        blood.append(predict_blood_insp4(insp4_row))
        scores["P_R+1_like_insp4_blood"] = round(blood[-1], 2)
    if osd571_row is not None:
        blood.append(predict_blood_osd571(osd571_row))
        scores["P_R+1_like_osd571_blood"] = round(blood[-1], 2)
    result = astrovital_flag(
        sleep_proba=scores.get("P_poor_sleep"),
        stress=scores.get("predicted_daily_stress"),
        hrv_anomaly_frac=scores.get("hrv_anomaly_frac"),
        blood_proba=max(blood) if blood else None,
        steps=steps, exercise_minutes=exercise_minutes,
    )
    result["scores"] = scores
    return result


BONE_COLUMNS_NOTE = "NHANES bone model: US adults 40-80. Screening only, not a diagnosis."
BONE_LABELS = {0: "Low", 1: "Medium", 2: "High"}
BONE_ADVICE = {
    0: "Bone density in the normal range. Keep active, keep the exercise routine.",
    1: "Low bone density range (osteopenia). Weight-bearing exercise, vitamin D and calcium as advised, ask about a DXA scan.",
    2: "High bone risk range. Ask the medical officer about a DXA scan and a bone health plan. Do not start treatment from this app.",
}


def predict_bone(profile):
    """Bone risk Low/Medium/High from one profile dict (model card 07).

    profile keys = the model's feature names (age, sex_female, bmi, grip_max_kg,
    vig_work_min_week, mod_work_min_week, vig_rec_min_week, mod_rec_min_week,
    sedentary_min_day, sleep_hours, trouble_sleeping). Missing keys become NaN,
    the pipeline fills them with the training median.
    """
    m = require_model("nhanes_bone_risk")
    cols = _features(m)
    row = pd.DataFrame([{c: profile.get(c) for c in cols}], columns=cols).astype(float)
    pred = int(m.predict(row)[0])
    proba = m.predict_proba(row)[0]
    classes = [int(c) for c in m.classes_]
    return {
        "bone_risk": pred,
        "bone_risk_label": BONE_LABELS[pred],
        "probabilities": {BONE_LABELS[c]: round(float(p), 3) for c, p in zip(classes, proba)},
        "advice": BONE_ADVICE[pred],
        "inputs_missing": [c for c in cols if profile.get(c) is None],
        "population": "Trained on US adults aged 40-80 (NHANES 2013-2014). Screening only, not a diagnosis, not an astronaut model.",
    }
