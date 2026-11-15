"""Deep-dive numbers for the Bone & Muscle page (POST /api/v1/ml/bone-muscle-insight).

The existing calculator and result stay exactly as they were (check-day / predict_bone). This module adds what sits
around them. Same rule as the other insight services: nothing is typed in and nothing is guessed. The frontend only
says WHICH data to look at (the same selectors as every page, the bone profile typed in the calculator, and the
astronaut). Everything else is read here:

  bone       the saved NHANES bone-risk model, opened up
               table        every input: your value, the target or healthy range (with source), where it stands, the
                            training-population average, and how hard it pushes the answer
               drivers      each input's push on "higher risk" (log-odds), split into what cannot be changed and what can
               levers       what the model says if one changeable input moved to its target (and, for scale, 5 more years)
               curves       how the three class probabilities move with age, BMI and grip strength for this profile
               reliability  base rates of the 3,127 training adults and what a Low / Medium / High answer is worth
  exercise   the astronaut's own logged sessions (table exercise_sessions): weekly minutes against the references,
             active days, streaks, gaps, strength days, adherence
  today      today's minutes (calculator / Daily Check-in) against the three references
  msk        musculoskeletal symptom reports from the body map, grouped as spine / load-bearing / limbs
  reference  published reference values (microgravity loss rates, exercise prescription). They are published averages,
             not measurements of this crew, and are labelled that way.

A block that cannot be computed is left out of the answer, never filled with a default. Targets and sources are written
in the constants below so the team can read and change them. Decision-support only, never a diagnosis; nothing here
changes the Good / Warning / Critical level (that stays in app/ml/predict.py).
"""
import math
import re
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from statistics import mean, median

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.body_map import symptom_service
from app.core.exceptions import AppError
from app.ml import predict
from app.models.exercise import ExerciseSession
from app.repositories import astronaut_repo
from app.schemas.ml import BoneMuscleRequest
from app.schemas.observation import to_utc
from app.services import ml_service
from app.services.vitals_insight_service import _clean

# ---- design choices and published references (written here so the team can read and change them) -------------
MIN_SESSIONS = 3                 # logged sessions needed before the exercise section appears
EX_FLAG_MIN = 20                 # minutes a day below which predict.py raises its weak exercise flag
WHO_WEEK_MIN, WHO_WEEK_MAX = 150, 300      # WHO 2020: minutes of moderate activity a week (vigorous counts double)
WHO_STRENGTH_DAYS = 2            # WHO 2020: muscle-strengthening on 2 or more days a week
FLIGHT_MIN_DAY, FLIGHT_DAYS_WEEK = 120, 6  # NASA: ISS crews exercise about 2 hours a day, 6 days a week
SEDENTARY_LINE = 480             # minutes a day (8 h): commonly used research cut-off for high sitting time
SLEEP_LINE = 7                   # hours, AASM/SRS 2015 (same line as the sleep rule in app/risk_engine/rules.py)
BMI_RANGE = (18.5, 24.9)         # WHO healthy range
GRIP_CUTOFF = {1: 16.0, 0: 27.0}  # kg, EWGSOP2 low-strength cut-offs: women, men
AGE_RANGE = (40, 80)             # what the model was trained on
LEVER_STEPS = {"mod_rec_min_week": 150, "vig_rec_min_week": 75, "sedentary_min_day": 60}  # what-if sizes (WHO week / one hour)
AGE_COMPARATOR_YEARS = 5         # "for scale" lever
RECURRING_REPORTS = 3            # reports in the window before a region counts as recurring

SRC = {
    "who_bmi": "WHO adult BMI classification: 18.5 to 24.9 is the healthy range.",
    "ewgsop2": "EWGSOP2 sarcopenia consensus (2019): grip strength under 27 kg (men) or 16 kg (women) is low muscle strength.",
    "who_pa": "WHO 2020 physical activity guidelines: 150 to 300 min a week of moderate activity (or 75 to 150 vigorous), plus muscle strengthening on 2 or more days.",
    "sedentary": "WHO advises limiting sitting without a fixed number; 8 h a day is a commonly used research cut-off for high sitting time.",
    "aasm": "AASM/SRS consensus (2015): 7 h or more a night for adults.",
    "nasa_ex": "NASA: ISS crew members exercise about 2 hours a day, 6 days a week (resistive, treadmill and cycle).",
}

MSK = {  # body-map region code -> group
    "neck": "spine", "upper_back": "spine", "lower_back": "spine",
    "legs": "load-bearing", "feet": "load-bearing",
    "arms": "limbs", "hands": "limbs",
}
LOAD_BEARING = {"lower_back", "legs", "feet"}

FEATURE_LABEL = {
    "age": "Age", "sex_female": "Sex", "bmi": "BMI", "grip_max_kg": "Grip strength",
    "vig_work_min_week": "Vigorous work", "mod_work_min_week": "Moderate work",
    "vig_rec_min_week": "Vigorous recreation", "mod_rec_min_week": "Moderate recreation",
    "sedentary_min_day": "Sedentary time", "sleep_hours": "Sleep", "trouble_sleeping": "Trouble sleeping",
}
ACTIVITY_KEYS = ("vig_work_min_week", "mod_work_min_week", "vig_rec_min_week", "mod_rec_min_week")
CLASS_NAMES = {0: "Low", 1: "Medium", 2: "High"}

PUBLISHED = [  # (area, what, value, applies, source) -- published averages, not measurements of this crew
    ("Bone", "Bone mineral density lost in weight-bearing bones (hip, spine) without countermeasures", "about 1 to 1.5% per month",
     "ISS-era astronauts, average; varies by person", "NASA Human Research Program (bone loss in microgravity)."),
    ("Muscle", "Muscle mass lost on a short flight without exercise", "up to 20% in 5 to 11 days",
     "Spaceflights of 5 to 11 days", "NASA (muscle atrophy in microgravity)."),
    ("Exercise", "In-flight exercise prescription", "about 2 h a day, 6 days a week", "ISS crews: resistive, treadmill and cycle", SRC["nasa_ex"]),
    ("Exercise", "Ground minimum for adults", "150 to 300 min a week + strength on 2+ days", "Healthy adults on Earth", SRC["who_pa"]),
]
MONTH_LOSS = (1.0, 1.5)          # % of bone mineral density per month, used only for the straight-line illustration
ILLUSTRATION_DAYS = (30, 90, 180)


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------
def _r(x, nd=1):
    return None if x is None or not math.isfinite(float(x)) else round(float(x), nd)


def _num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _status(value, low=None, high=None):
    """in_range / below / above / missing against a target range (None bound = open)."""
    if value is None:
        return "missing"
    if low is not None and value < low:
        return "below"
    if high is not None and value > high:
        return "above"
    return "in_range"


# ---------------------------------------------------------------------------------------------
# bone model, opened up
# ---------------------------------------------------------------------------------------------
class _Model:
    """The saved NHANES pipeline pulled apart so each step can be read."""

    def __init__(self):
        m = predict.require_model("nhanes_bone_risk")
        self.pipe = m
        self.cols = predict._features(m)
        self.imputer, self.scaler, self.clf = m.named_steps["imputer"], m.named_steps["scaler"], m.named_steps["clf"]
        self.classes = [int(c) for c in self.clf.classes_]

    def used(self, profile):
        row = pd.DataFrame([{c: profile.get(c) for c in self.cols}], columns=self.cols).astype(float)
        return dict(zip(self.cols, self.imputer.transform(row)[0].tolist()))

    def proba(self, used):
        x = pd.DataFrame([used], columns=self.cols)
        return {CLASS_NAMES[c]: float(p) for c, p in zip(self.classes, self.pipe.predict_proba(x)[0])}

    def z(self, used):
        return dict(zip(self.cols, self.scaler.transform(pd.DataFrame([used], columns=self.cols))[0].tolist()))


def _not_low(p):
    return 1.0 - p["Low"]


def _training(model):
    return {c: {"mean": float(model.scaler.mean_[i]), "sd": float(model.scaler.scale_[i]), "median": float(model.imputer.statistics_[i])}
            for i, c in enumerate(model.cols)}


def _reliability(metrics):
    bone = metrics.get("nhanes_bone_risk") or {}
    counts = bone.get("class_counts") or {}
    n = sum(counts.values()) or None
    per_class = {}
    report = (bone.get("logistic_regression_cv") or {}).get("classification_report") or ""
    for name, prec, rec, _f1, support in re.findall(r"^\s*(Low|Medium|High)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+(\d+)", report, flags=re.M):
        per_class[name] = {"precision": float(prec), "recall": float(rec), "support": int(support)}
    cv = bone.get("logistic_regression_cv") or {}
    return {
        "n": n, "population": bone.get("population"), "target": bone.get("target"),
        "base_rates": {CLASS_NAMES[int(k)]: v / n for k, v in counts.items()} if n else None,
        "macro_auc": cv.get("macro_auc_ovr"), "balanced_accuracy": cv.get("balanced_accuracy"), "accuracy": cv.get("accuracy"),
        "majority_baseline_accuracy": bone.get("majority_baseline_accuracy"), "per_class": per_class or None,
        "validation": bone.get("validation"),
    }


def _table(profile, used, z, train, push):
    sex = profile.get("sex_female")
    grip_cut = GRIP_CUTOFF.get(int(sex)) if sex is not None else None
    act_vals = [profile.get(k) for k in ACTIVITY_KEYS]
    entered_act = [v for v in act_vals if v is not None]
    mvpa = None
    if entered_act:
        g = lambda k: profile.get(k) or 0  # noqa: E731
        mvpa = g("mod_work_min_week") + g("mod_rec_min_week") + 2 * (g("vig_work_min_week") + g("vig_rec_min_week"))
    act_push = sum(push[k] for k in ACTIVITY_KEYS)
    used_mvpa = used["mod_work_min_week"] + used["mod_rec_min_week"] + 2 * (used["vig_work_min_week"] + used["vig_rec_min_week"])
    train_act = sum(train[k]["mean"] for k in ("mod_work_min_week", "mod_rec_min_week")) + 2 * sum(train[k]["mean"] for k in ("vig_work_min_week", "vig_rec_min_week"))

    def row(key, label, unit, value, target, low, high, source, modifiable, push_v, train_row, note=None, used_value=None, imputed=None):
        return {"key": key, "label": label, "unit": unit, "value": value, "entered": value is not None,
                "used_value": used_value if used_value is not None else (used.get(key) if value is None else value), "imputed": (value is None) if imputed is None else imputed,
                "target": target, "target_low": low, "target_high": high, "status": _status(value, low, high), "source": source,
                "modifiable": modifiable, "push": _r(push_v, 3), "training": train_row, "note": note}

    age = _num(profile.get("age"))
    rows = [
        row("age", "Age", "years", age, f"model covers {AGE_RANGE[0]} to {AGE_RANGE[1]}", AGE_RANGE[0], AGE_RANGE[1], "Training range of the NHANES model.", False, push["age"], train["age"],
            note="Under 40 the model is extrapolating." if age is not None and age < AGE_RANGE[0] else None),
        row("bmi", "BMI", "kg/m2", _num(profile.get("bmi")), f"{BMI_RANGE[0]} to {BMI_RANGE[1]}", BMI_RANGE[0], BMI_RANGE[1], SRC["who_bmi"], True, push["bmi"], train["bmi"],
            note="Slow to change; shown for completeness."),
        row("grip_max_kg", "Grip strength", "kg", _num(profile.get("grip_max_kg")),
            (f"{grip_cut:g} kg or more" if grip_cut else f"{GRIP_CUTOFF[0]:g} kg (men) / {GRIP_CUTOFF[1]:g} kg (women) or more" if False else
             f"{GRIP_CUTOFF[0]:g} kg or more (men), {GRIP_CUTOFF[1]:g} kg or more (women)" if sex is None else None),
            grip_cut, None, SRC["ewgsop2"], True, push["grip_max_kg"], train["grip_max_kg"],
            note=None if grip_cut else "Add sex to see the cut-off that applies."),
        {"key": "activity", "label": "Activity, moderate-equivalent", "unit": "min/week", "value": mvpa, "entered": mvpa is not None, "used_value": used_mvpa,
         "imputed": mvpa is None, "target": f"{WHO_WEEK_MIN} to {WHO_WEEK_MAX} (vigorous counts double)", "target_low": WHO_WEEK_MIN, "target_high": None,
         "status": _status(mvpa, WHO_WEEK_MIN, None), "source": SRC["who_pa"], "modifiable": True, "push": _r(act_push, 3),
         "training": {"mean": train_act, "sd": None, "median": None},
         "note": "Work plus recreation: moderate minutes + 2 x vigorous minutes. The model takes the four inputs separately."},
        row("sedentary_min_day", "Sedentary time", "min/day", _num(profile.get("sedentary_min_day")), f"under {SEDENTARY_LINE} (8 h)", None, SEDENTARY_LINE, SRC["sedentary"], True,
            push["sedentary_min_day"], train["sedentary_min_day"]),
        row("sleep_hours", "Sleep", "h/night", _num(profile.get("sleep_hours")), f"{SLEEP_LINE} or more", SLEEP_LINE, None, SRC["aasm"], True, push["sleep_hours"], train["sleep_hours"]),
        row("trouble_sleeping", "Trouble sleeping", "yes / no", _num(profile.get("trouble_sleeping")), "no", None, 0, "Self-report in NHANES.", True, push["trouble_sleeping"], train["trouble_sleeping"]),
    ]
    rows.insert(1, row("sex_female", "Sex", "", _num(sex), "no target, cannot be changed", None, None, "NHANES coding: 1 = female, 0 = male.", False, push["sex_female"], train["sex_female"]))
    return rows


def _drivers(model, used, z):
    """Each input's push on 'higher risk': (High coefficient minus Low coefficient) x standardised value, in log-odds."""
    hi, lo = model.classes.index(2), model.classes.index(0)
    diff = model.clf.coef_[hi] - model.clf.coef_[lo]
    push = {c: float(diff[i] * z[c]) for i, c in enumerate(model.cols)}
    fixed_keys = {"age", "sex_female"}
    total = sum(abs(v) for v in push.values()) or 1.0
    items = [{"key": c, "label": FEATURE_LABEL[c], "value": _r(used[c], 2), "z": _r(z[c], 2), "push": _r(v, 3), "share": _r(abs(v) / total, 3),
              "raises_risk": v > 0, "modifiable": c not in fixed_keys} for c, v in push.items()]
    items.sort(key=lambda d: abs(d["push"]), reverse=True)
    return push, {"items": items, "fixed_share": _r(sum(abs(push[k]) for k in fixed_keys) / total, 3),
                  "changeable_share": _r(1 - sum(abs(push[k]) for k in fixed_keys) / total, 3),
                  "note": "Each bar = how far the input is from the training average (in spreads) times the model's weight for it, as the push on High against Low (log-odds). Right = pushes towards higher bone risk."}


def _levers(model, profile, used, base):
    out, combined = [], dict(used)
    sex = profile.get("sex_female")

    def add(key, label, change, new_value, current):
        trial = dict(used)
        trial[key] = new_value
        p = model.proba(trial)
        combined[key] = new_value
        out.append({"key": key, "label": label, "change": change, "from": _r(current, 1), "to": _r(new_value, 1),
                    "high_before": _r(base["High"], 4), "high_after": _r(p["High"], 4), "not_low_before": _r(_not_low(base), 4), "not_low_after": _r(_not_low(p), 4),
                    "delta_high_points": _r((p["High"] - base["High"]) * 100, 2), "delta_not_low_points": _r((_not_low(p) - _not_low(base)) * 100, 2)})

    for key in ("mod_rec_min_week", "vig_rec_min_week"):
        if profile.get(key) is not None:
            step = LEVER_STEPS[key]
            add(key, FEATURE_LABEL[key], f"+{step} min a week", used[key] + step, used[key])
    if profile.get("sedentary_min_day") is not None and used["sedentary_min_day"] > 0:
        step = min(LEVER_STEPS["sedentary_min_day"], used["sedentary_min_day"])
        add("sedentary_min_day", "Sedentary time", f"{step:g} min less sitting a day", used["sedentary_min_day"] - step, used["sedentary_min_day"])
    if profile.get("sleep_hours") is not None and used["sleep_hours"] < SLEEP_LINE:
        add("sleep_hours", "Sleep", f"up to {SLEEP_LINE} h a night", float(SLEEP_LINE), used["sleep_hours"])
    if profile.get("trouble_sleeping") == 1:
        add("trouble_sleeping", "Trouble sleeping", "no longer having trouble", 0.0, 1.0)
    if sex is not None and profile.get("grip_max_kg") is not None and used["grip_max_kg"] < GRIP_CUTOFF[int(sex)]:
        add("grip_max_kg", "Grip strength", f"up to the {GRIP_CUTOFF[int(sex)]:g} kg cut-off", GRIP_CUTOFF[int(sex)], used["grip_max_kg"])
    if profile.get("bmi") is not None and not (BMI_RANGE[0] <= used["bmi"] <= BMI_RANGE[1]):
        target = BMI_RANGE[1] if used["bmi"] > BMI_RANGE[1] else BMI_RANGE[0]
        add("bmi", "BMI", f"into the healthy range ({target:g})", target, used["bmi"])
    together = None
    if len(out) > 1:
        p = model.proba(combined)
        together = {"high_after": _r(p["High"], 4), "not_low_after": _r(_not_low(p), 4),
                    "delta_high_points": _r((p["High"] - base["High"]) * 100, 2), "delta_not_low_points": _r((_not_low(p) - _not_low(base)) * 100, 2)}
    older = dict(used)
    older["age"] = used["age"] + AGE_COMPARATOR_YEARS
    po = model.proba(older)
    scale = {"label": f"{AGE_COMPARATOR_YEARS} more years of age", "delta_high_points": _r((po["High"] - base["High"]) * 100, 2),
             "delta_not_low_points": _r((_not_low(po) - _not_low(base)) * 100, 2)}
    out.sort(key=lambda d: d["delta_not_low_points"])
    return {"items": out, "together": together, "for_scale": scale,
            "note": "What the model would say if only that one input changed to its target. These are associations in US adults aged 40 to 80, not promises for one person."} if out else \
        {"items": [], "together": None, "for_scale": scale, "note": "Every changeable input you entered is already at its target, or none were entered."}


def _curves(model, used):
    def sweep(key, values):
        pts = []
        for v in values:
            trial = dict(used)
            trial[key] = float(v)
            p = model.proba(trial)
            pts.append({"x": float(v), "low": _r(p["Low"], 4), "medium": _r(p["Medium"], 4), "high": _r(p["High"], 4)})
        return pts
    return {
        "age": {"label": "Age (years)", "current": _r(used["age"], 1), "points": sweep("age", range(AGE_RANGE[0], AGE_RANGE[1] + 1, 2))},
        "bmi": {"label": "BMI", "current": _r(used["bmi"], 1), "points": sweep("bmi", range(16, 41, 1))},
        "grip_max_kg": {"label": "Grip strength (kg)", "current": _r(used["grip_max_kg"], 1), "points": sweep("grip_max_kg", range(10, 62, 2))},
    }


def _bone_reading(base, rel, table, drivers, levers, profile, used):
    cards = []
    br = (rel or {}).get("base_rates") or {}
    if br:
        cards.append({"tone": "mute", "title": "Against the training adults",
                      "text": f"The model puts {base['High'] * 100:.0f}% on High and {_not_low(base) * 100:.0f}% on Medium or High, against {br['High'] * 100:.0f}% and "
                              f"{(br['Medium'] + br['High']) * 100:.0f}% among the {rel['n']:,} US adults it was trained on.", "evidence": "screening"})
    pc = (rel or {}).get("per_class") or {}
    if pc.get("High") and rel.get("macro_auc") is not None:
        cards.append({"tone": "warn", "title": "What a High result is worth",
                      "text": f"In cross-validation a High answer was right {pc['High']['precision'] * 100:.0f} times in 100 and caught {pc['High']['recall'] * 100:.0f} of every 100 truly High "
                              f"adults. Macro AUC is {rel['macro_auc']:.2f}, so it ranks risk better than chance, but it is a screening flag, not a result.", "evidence": "screening"})
    top = drivers["items"][0]
    cards.append({"tone": "mute", "title": f"{top['label']} pushes hardest",
                  "text": f"{top['label']} accounts for {top['share'] * 100:.0f}% of the push on this answer ({'towards higher' if top['raises_risk'] else 'towards lower'} risk). "
                          f"Age and sex together are {drivers['fixed_share'] * 100:.0f}% of the push and cannot be changed; the rest ({drivers['changeable_share'] * 100:.0f}%) can.", "evidence": "screening"})
    out = [r for r in table if r["status"] in ("below", "above")]
    if out:
        cards.append({"tone": "warn", "title": f"{len(out)} input{'s' if len(out) != 1 else ''} outside the target",
                      "text": "; ".join(f"{r['label'].lower()} {r['value']:g} {r['unit']} (target {r['target']})" for r in out[:4]) + ".", "evidence": "convention"})
    elif any(r["entered"] for r in table):
        cards.append({"tone": "ok", "title": "Entered inputs are inside their targets", "text": "Every input you entered sits inside its target or healthy range.", "evidence": "convention"})
    if levers["items"]:
        best = levers["items"][0]
        sc = levers["for_scale"]
        cards.append({"tone": "mute", "title": "How much the levers move it",
                      "text": f"The largest single lever ({best['label'].lower()}, {best['change']}) changes Medium-or-High by {best['delta_not_low_points']:+.1f} points. "
                              f"For scale, {sc['label']} changes it by {sc['delta_not_low_points']:+.1f} points. Age, BMI and grip dominate this model; activity barely moves it.", "evidence": "proxy"})
    missing = [FEATURE_LABEL[k].lower() for k in profile_keys() if profile.get(k) is None]
    if missing:
        cards.append({"tone": "warn", "title": f"{len(missing)} input{'s' if len(missing) != 1 else ''} not entered",
                      "text": "The model used the training median for " + ", ".join(missing[:6]) + ("…" if len(missing) > 6 else "") + ". Enter them in the calculator for a result that is about this person.", "evidence": "screening"})
    return cards


def profile_keys():
    return list(FEATURE_LABEL)


def _bone_block(profile, source):
    try:
        model = _Model()
    except FileNotFoundError:
        return None
    used = model.used(profile)
    z = model.z(used)
    base = model.proba(used)
    train = _training(model)
    push, drivers = _drivers(model, used, z)
    metrics = ml_service._read_json("metrics.json") or {}
    rel = _reliability(metrics)
    table = _table(profile, used, z, train, push)
    levers = _levers(model, profile, used, base)
    return {
        "available": True, "source": source, "probabilities": {k: _r(v, 4) for k, v in base.items()}, "not_low": _r(_not_low(base), 4),
        "table": table, "drivers": drivers, "levers": levers, "curves": _curves(model, used), "reliability": rel,
        "reading": _bone_reading(base, rel, table, drivers, levers, profile, used),
        "table_note": "Training average = mean of the 3,127 NHANES adults. 'Push' = that input's push on higher bone risk, in log-odds (activity is the sum of its four inputs). "
                      "Inputs left blank are replaced by the training median inside the model.",
    }


# ---------------------------------------------------------------------------------------------
# exercise log
# ---------------------------------------------------------------------------------------------
def _runs(active, dates):
    """(current streak, longest streak, longest gap) over consecutive calendar days, newest last."""
    cur = best = gap = gap_best = 0
    for a in active:
        if a:
            cur += 1
            gap = 0
        else:
            cur = 0
            gap += 1
        best, gap_best = max(best, cur), max(gap_best, gap)
    return cur, best, gap_best


def _exercise_block(db: Session, astronaut_id: int, days: int):
    newest = db.scalar(select(ExerciseSession).where(ExerciseSession.astronaut_id == astronaut_id).order_by(ExerciseSession.performed_at.desc(), ExerciseSession.id.desc()).limit(1))
    if newest is None:
        return None
    end = to_utc(newest.performed_at)
    start = end - timedelta(days=days)
    rows = list(db.scalars(select(ExerciseSession).where(ExerciseSession.astronaut_id == astronaut_id, ExerciseSession.performed_at >= start, ExerciseSession.performed_at <= end)
                           .order_by(ExerciseSession.performed_at, ExerciseSession.id)))
    if len(rows) < MIN_SESSIONS:
        return {"available": False, "sessions": len(rows), "needed": MIN_SESSIONS, "reason": f"{len(rows)} session{'s' if len(rows) != 1 else ''} logged so far; {MIN_SESSIONS} are needed."}
    per = defaultdict(lambda: {"minutes": 0, "kinds": set(), "sessions": 0})
    for r in rows:
        d = to_utc(r.performed_at).date()
        per[d]["minutes"] += r.minutes
        per[d]["kinds"].add(r.kind)
        per[d]["sessions"] += 1
    last = end.date()
    first = min(per)
    span = [first + timedelta(days=i) for i in range((last - first).days + 1)]
    daily = [{"date": d.isoformat(), "minutes": per[d]["minutes"] if d in per else 0, "kinds": sorted(per[d]["kinds"]) if d in per else [], "sessions": per[d]["sessions"] if d in per else 0} for d in span]
    active = [d in per for d in span]
    cur, best, gap = _runs(active, span)
    strength = lambda d: d in per and bool(per[d]["kinds"] & {"resistive", "mixed"})  # noqa: E731

    def block(end_d, n=7):
        ds = [end_d - timedelta(days=i) for i in range(n - 1, -1, -1)]
        return {"start": ds[0].isoformat(), "end": ds[-1].isoformat(), "minutes": sum(per[d]["minutes"] for d in ds if d in per), "active_days": sum(d in per for d in ds),
                "strength_days": sum(strength(d) for d in ds), "sessions": sum(per[d]["sessions"] for d in ds if d in per)}

    n_weeks = max(1, min(days // 7, math.ceil(len(span) / 7)))
    weeks = [block(last - timedelta(days=7 * i)) for i in range(n_weeks - 1, -1, -1)]
    full_weeks = [w for w in weeks if (date.fromisoformat(w["end"]) - date.fromisoformat(w["start"])).days == 6 and date.fromisoformat(w["start"]) >= first]
    l7, p7 = block(last), block(last - timedelta(days=7))
    p7_ok = date.fromisoformat(p7["start"]) >= first
    by_kind = defaultdict(lambda: {"minutes": 0, "sessions": 0})
    for r in rows:
        by_kind[r.kind]["minutes"] += r.minutes
        by_kind[r.kind]["sessions"] += 1
    total = sum(r.minutes for r in rows)
    meeting_flag = sum(1 for d in span if d in per and per[d]["minutes"] >= EX_FLAG_MIN)
    summary = {
        "sessions": len(rows), "total_minutes": total, "days_in_span": len(span), "active_days": sum(active), "active_share": _r(sum(active) / len(span), 3),
        "avg_minutes_per_active_day": _r(total / max(1, sum(active))), "current_streak": cur, "longest_streak": best, "longest_gap_days": gap,
        "last7": l7, "prev7": p7 if p7_ok else None,
        "change_pct": _r((l7["minutes"] - p7["minutes"]) / p7["minutes"] * 100, 0) if p7_ok and p7["minutes"] else None,
        "kinds": {k: {"minutes": v["minutes"], "sessions": v["sessions"], "share": _r(v["minutes"] / total, 3)} for k, v in by_kind.items()},
    }
    adherence = {
        "days_meeting_flag": meeting_flag, "share_meeting_flag": _r(meeting_flag / len(span), 3),
        "full_weeks": len(full_weeks), "weeks_meeting_who": sum(w["minutes"] >= WHO_WEEK_MIN for w in full_weeks),
        "weeks_meeting_strength": sum(w["strength_days"] >= WHO_STRENGTH_DAYS for w in full_weeks),
        "weeks_meeting_flight": sum(w["minutes"] >= FLIGHT_MIN_DAY * FLIGHT_DAYS_WEEK for w in full_weeks),
    }
    refs = {"flag_min_day": EX_FLAG_MIN, "who_week_min": WHO_WEEK_MIN, "who_week_max": WHO_WEEK_MAX, "strength_days_week": WHO_STRENGTH_DAYS,
            "flight_min_day": FLIGHT_MIN_DAY, "flight_days_week": FLIGHT_DAYS_WEEK, "flight_week_min": FLIGHT_MIN_DAY * FLIGHT_DAYS_WEEK,
            "sources": {"who": SRC["who_pa"], "nasa": SRC["nasa_ex"]}}
    return {"available": True, "window": {"days": days, "start": span[0].isoformat(), "end": last.isoformat(), "days_since_latest": max(0, (datetime.now(UTC).date() - last).days)},
            "rules": refs, "daily": daily, "weeks": weeks, "summary": summary, "adherence": adherence, "reading": _exercise_reading(summary, adherence, refs, weeks)}


def _exercise_reading(s, a, refs, weeks):
    cards = []
    l7 = s["last7"]
    tone = "ok" if l7["minutes"] >= refs["who_week_min"] else "warn"
    cards.append({"tone": tone, "title": "The last 7 days", "evidence": "convention",
                  "text": f"{l7['minutes']} min on {l7['active_days']} of 7 days, against the ground minimum of {refs['who_week_min']} min and the in-flight routine of about {refs['flight_week_min']} min a week."
                          + (f" That is {s['change_pct']:+.0f}% on the 7 days before." if s["change_pct"] is not None else "")})
    cards.append({"tone": "ok" if l7["strength_days"] >= refs["strength_days_week"] else "warn", "title": "Strength days", "evidence": "convention",
                  "text": f"{l7['strength_days']} strength day{'s' if l7['strength_days'] != 1 else ''} in the last 7 against the {refs['strength_days_week']}+ recommended. Bone and muscle are loaded by resistive work, not by walking alone."})
    if s["longest_gap_days"] >= 3:
        cards.append({"tone": "warn" if s["longest_gap_days"] < 5 else "bad", "title": "Gaps in loading", "evidence": "proxy",
                      "text": f"The longest stretch without a session was {s['longest_gap_days']} days. Streaks and gaps matter more than the weekly total, because the loss does not wait for the weekend."})
    if a["full_weeks"]:
        cards.append({"tone": "ok" if a["weeks_meeting_who"] == a["full_weeks"] else "mute", "title": "Weeks meeting the ground minimum", "evidence": "proxy",
                      "text": f"{a['weeks_meeting_who']} of {a['full_weeks']} full weeks reached {refs['who_week_min']} min; {a['weeks_meeting_strength']} had {refs['strength_days_week']}+ strength days; "
                              f"{a['weeks_meeting_flight']} matched the in-flight routine."})
    k = s["kinds"]
    if k and not (k.get("resistive") or k.get("mixed")):
        cards.append({"tone": "warn", "title": "No resistive work logged", "evidence": "proxy",
                      "text": "Every logged session is aerobic or other. Resistive loading is what the in-flight bone and muscle countermeasure is built around."})
    return cards


def _today_block(chosen):
    m = _num(chosen.get("exercise_minutes"))
    if m is None:
        return None
    return {"minutes": m, "flag_min": EX_FLAG_MIN, "who_daily": _r(WHO_WEEK_MIN / 7, 1), "flight_daily": FLIGHT_MIN_DAY,
            "steps": _num(chosen.get("steps")),
            "sources": {"who": SRC["who_pa"], "nasa": SRC["nasa_ex"]}}


# ---------------------------------------------------------------------------------------------
# musculoskeletal symptoms (body map)
# ---------------------------------------------------------------------------------------------
def _msk_block(db: Session, astronaut_id: int, days: int):
    try:
        res = symptom_service.trends_for_astronaut(db, astronaut_id, days, None, None)
    except AppError:
        return None
    regions = []
    for r in res.regions:
        group = MSK.get(r.region_code)
        if group is None:
            continue
        regions.append({"code": r.region_code, "name": r.region_name, "group": group, "load_bearing": r.region_code in LOAD_BEARING, "count": r.count,
                        "mean_severity": _r(r.mean_severity), "max_severity": r.max_severity, "latest_severity": r.latest_severity,
                        "latest_reported_at": r.latest_reported_at.isoformat(), "trend": r.trend, "recurring": r.count >= RECURRING_REPORTS,
                        "types": sorted(r.symptom_types.items(), key=lambda kv: kv[1], reverse=True)[:3]})
    if not regions:
        return None
    regions.sort(key=lambda d: (d["latest_severity"], d["count"]), reverse=True)
    lb = [r for r in regions if r["load_bearing"]]
    cards = []
    worst = regions[0]
    cards.append({"tone": "bad" if worst["latest_severity"] >= 7 else "warn" if worst["latest_severity"] >= 4 else "mute", "title": f"{worst['name']} is the most concerning region", "evidence": "proxy",
                  "text": f"Latest {worst['latest_severity']}/10, {worst['count']} report{'s' if worst['count'] != 1 else ''} in {days} days" + (f" ({worst['trend']})." if worst["trend"] != "insufficient_data" else ".")})
    if lb:
        cards.append({"tone": "warn" if any(r["recurring"] for r in lb) else "mute", "title": "Load-bearing regions", "evidence": "proxy",
                      "text": ", ".join(f"{r['name'].lower()} {r['count']}×" for r in lb) + ". Pain where the body is loaded is worth raising with the medical officer before it limits training."})
    return {"available": True, "days": days, "total_reports": sum(r["count"] for r in regions), "regions": regions, "reading": cards,
            "note": "From body-map symptom reports. Reports are self-described; severity is 1 to 10. Not a diagnosis."}


def _reference_block():
    illustr = [{"days": d, "low": _r(MONTH_LOSS[0] * d / 30, 1), "high": _r(MONTH_LOSS[1] * d / 30, 1)} for d in ILLUSTRATION_DAYS]
    return {"rows": [{"area": a, "what": w, "value": v, "applies": ap, "source": s} for a, w, v, ap, s in PUBLISHED], "illustration": illustr,
            "illustration_note": "Straight-line arithmetic on the published monthly rate, for the hip and spine without countermeasures. Real loss varies by person, by bone and by how well the exercise routine is kept. These are published averages, not measurements of this crew."}


# ---------------------------------------------------------------------------------------------
def get_bone_muscle_insight(db: Session, req: BoneMuscleRequest) -> dict:
    chosen, _subject, _scenario = ml_service._merge_defaults(req)
    profile = chosen.get("bone_profile") or {}
    typed = bool(req.bone_profile and any(v is not None for v in req.bone_profile.model_dump().values()))
    source = "calculator, empty boxes from the crew file" if typed and ml_service._merge_defaults(req.model_copy(update={"bone_profile": None}))[0].get("bone_profile") else "calculator" if typed else "crew file"
    bone = _bone_block(profile, source) if profile else None
    exercise = msk = None
    if astronaut_repo.get(db, req.astronaut_id) is not None:
        exercise = _exercise_block(db, req.astronaut_id, req.days)
        msk = _msk_block(db, req.astronaut_id, req.days)
    backend = ml_service._merge_defaults(req.model_copy(update={"bone_profile": None}))[0].get("bone_profile") or None
    return _clean({"selection": {"astronaut_id": req.astronaut_id}, "backend_profile": backend, "bone": bone, "today": _today_block(chosen), "exercise": exercise, "msk": msk,
                   "reference": _reference_block(), "disclaimer": "Screening and decision support only. Not a diagnosis."})
