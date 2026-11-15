"""Deep-dive numbers for the Mental Wellbeing page, questionnaire side
(POST/GET /api/v1/ml/wellbeing-insight).

Same rule as vitals_insight_service: nothing is typed in. The frontend only says WHICH data to look at
(scenario / subject / mmash_user). This module reads the MMASH files in the data folder, uses the saved
models only where it says so, and returns plain numbers:

  variables    every questionnaire score of the selected volunteer (daily stress, anxiety, affect, PSQI,
               anything else numeric in the psychological file) next to the volunteer cohort: middle,
               range, quartiles, share of the other volunteers it is above, reference line where one exists
  cohort       every volunteer's values, so the page can draw a mind-body map
  pairs        Spearman correlation of every pair of variables (questionnaires, sleep, activity, HRV means)
  model_check  what the saved stress and sleep models predicted for this volunteer against what the
               volunteer actually reported, next to the model's published miss (metrics.json)
  reading      plain-language findings built from the blocks above

Nothing here changes the Good / Warning / Critical level. That stays in app/ml/predict.py.
The cohort is 21 healthy young men on Earth (2 days each), not astronauts: every comparison is
"against these volunteers", and the correlations are exploratory (n = 21).
"""
import math

import numpy as np
import pandas as pd

from app.core.exceptions import AppError
from app.ml import data_store, predict
from app.schemas.ml import DayRequest
from app.services import ml_service
from app.services.vitals_insight_service import _clean, _num, _share_below

# ---- design choices (written here so the team can read and change them) ----------------------
HIGH_SHARE, LOW_SHARE = 0.75, 0.25   # above 75% / below 25% of the other volunteers = "higher" / "lower"
PSQI_POOR = 5                        # PSQI over 5 = poor sleeper (same line the backend sleep model uses as its target)
STAI_LINE, STAI_RANGE = 40, (20, 80) # common screening cut-off for elevated anxiety; only drawn when the data sits in the instrument's 20-80 range
MIN_PAIR_N = 8                       # a correlation needs at least this many volunteers with both values
MEANINGFUL_R, ALPHA = 0.4, 0.05      # |rho| of 0.4 or more AND p under 0.05 is called a link worth reading

MIND = [  # (column, label, instrument, higher_is_better)
    ("Daily_stress", "Daily stress", "Daily stress score", False),
    ("STAI1", "Anxiety, form 1 (state)", "STAI form Y-1", False),
    ("STAI2", "Anxiety, form 2 (trait)", "STAI form Y-2", False),
    ("panas_pos_10", "Positive affect", "PANAS, 10 items", True),
    ("panas_neg_10", "Negative affect", "PANAS, 10 items", False),
    ("Pittsburgh", "Sleep-quality score (PSQI)", "higher = worse sleep", False),
]
DERIVED = [("affect_balance", "Affect balance", "positive minus negative affect", True, "panas_pos_10", "panas_neg_10")]
BODY = [  # (column in the merged MMASH table, label, unit, group)
    ("sleep_efficiency_percent", "Sleep efficiency", "%", "sleep"),
    ("total_sleep_minutes", "Total sleep", "min", "sleep"),
    ("total_waso_minutes", "Awake after falling asleep", "min", "sleep"),
    ("total_awakenings", "Night awakenings", "", "sleep"),
    ("steps_per_day", "Steps per day", "steps", "body"),
    ("mean_vector_magnitude", "Movement magnitude", "", "body"),
    ("original_mean_heart_rate_bpm", "Mean heart rate", "bpm", "body"),
    ("hrv_mean_rr_rmssd_ms", "HRV, beat to beat (RMSSD)", "ms", "body"),
    ("hrv_mean_rr_sdnn_ms", "HRV, overall (SDNN)", "ms", "body"),
]


def _pretty(col):
    return col.replace("_", " ").strip().capitalize()


def _strength(r):
    a = abs(r)
    return "strong" if a >= 0.6 else "moderate" if a >= 0.4 else "weak" if a >= 0.2 else "negligible"


def _spearman(x, y):
    """(r, p, n) over the volunteers that have both values, or None."""
    d = pd.concat([pd.to_numeric(x, errors="coerce"), pd.to_numeric(y, errors="coerce")], axis=1).dropna()
    n = len(d)
    if n < MIN_PAIR_N or d.iloc[:, 0].nunique() < 2 or d.iloc[:, 1].nunique() < 2:
        return None
    try:
        from scipy.stats import spearmanr  # ships with scikit-learn
        res = spearmanr(d.iloc[:, 0], d.iloc[:, 1])
        r, p = float(res.statistic), float(res.pvalue)
    except Exception:  # noqa: BLE001  no scipy: no correlation instead of a made-up one
        return None
    return (r, p, n) if math.isfinite(r) and math.isfinite(p) else None


def _frame():
    """The merged MMASH table the models were trained on, plus the derived columns."""
    m = data_store.mmash_merged().copy()
    if "total_steps" in m.columns and "recorded_days" in m.columns:
        m["steps_per_day"] = np.where(m["recorded_days"] > 0, m["total_steps"] / m["recorded_days"], np.nan)
    for key, _label, _note, _hib, plus, minus in DERIVED:
        if plus in m.columns and minus in m.columns:
            m[key] = pd.to_numeric(m[plus], errors="coerce") - pd.to_numeric(m[minus], errors="coerce")
    return m


def _catalog(frame):
    """Every variable the page can show: [(key, label, unit, group, note, higher_is_better)]."""
    out, seen = [], set()
    for col, label, note, hib in MIND:
        if col in frame.columns:
            out.append((col, label, "", "mind", note, hib)); seen.add(col)
    for col, label, note, hib, _p, _m in DERIVED:
        if col in frame.columns:
            out.append((col, label, "", "mind", note, hib)); seen.add(col)
    # any other numeric column of the psychological file shows up too, without a good/bad direction
    try:
        psych = data_store._read("psych")
        for col in psych.columns:
            if col == "participant_id" or col in seen or col not in frame.columns:
                continue
            if pd.api.types.is_numeric_dtype(frame[col]) and frame[col].nunique() > 1:
                out.append((col, _pretty(col), "", "mind", "questionnaire score", None)); seen.add(col)
    except data_store.DataNotFound:
        pass
    for col, label, unit, group in BODY:
        if col in frame.columns and pd.api.types.is_numeric_dtype(frame[col]) and frame[col].nunique() > 1:
            out.append((col, label, unit, group, "", None))
    return out


def _reference(col, series):
    """A reference line, only when the data can back it up."""
    s = pd.to_numeric(series, errors="coerce").dropna()
    if col == "Pittsburgh":
        return {"value": PSQI_POOR, "text": f"over {PSQI_POOR} = poor sleeper", "kind": "PSQI convention"}
    if col in ("STAI1", "STAI2") and len(s) and s.min() >= STAI_RANGE[0] and s.max() <= STAI_RANGE[1]:
        return {"value": STAI_LINE, "text": f"{STAI_LINE} or more = elevated anxiety on screening", "kind": "screening convention"}
    return None


def _variables(frame, user, catalog):
    me = frame[frame["participant_id"] == user].iloc[0]
    out = []
    for key, label, unit, group, note, hib in catalog:
        col = pd.to_numeric(frame[key], errors="coerce")
        valid = frame.assign(_v=col).dropna(subset=["_v"])
        if valid.empty:
            continue
        mine = _num(me[key])
        others = valid.loc[valid["participant_id"] != user, "_v"].tolist()
        share = _share_below(others, mine) if mine is not None else None
        verdict = None if share is None else "higher" if share >= HIGH_SHARE else "lower" if share <= LOW_SHARE else "typical"
        ref = _reference(key, valid["_v"])
        # rank: 1 = highest value in the cohort
        rank = int((valid["_v"] > mine).sum()) + 1 if mine is not None else None
        out.append({
            "key": key, "label": label, "unit": unit, "group": group, "note": note, "higher_is_better": hib,
            "value": mine, "n": int(len(valid)),
            "middle": float(valid["_v"].median()), "mean": float(valid["_v"].mean()),
            "q25": float(valid["_v"].quantile(0.25)), "q75": float(valid["_v"].quantile(0.75)),
            "min": float(valid["_v"].min()), "max": float(valid["_v"].max()),
            "higher_than": share, "verdict": verdict, "rank_from_top": rank,
            "reference": ref,
            "past_reference": None if ref is None or mine is None else bool(mine > ref["value"] if key == "Pittsburgh" else mine >= ref["value"]),
        })
    return out


def _pairs(frame, catalog):
    keys = [c[0] for c in catalog]
    out = []
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            if a == "affect_balance" and b in ("panas_pos_10", "panas_neg_10"):
                continue  # derived from these two, so the link would be circular
            res = _spearman(frame[a], frame[b])
            if res is None:
                continue
            r, p, n = res
            out.append({"a": a, "b": b, "r": r, "p": p, "n": n, "strength": _strength(r), "together": r > 0})
    return out


def _cohort(frame, user, catalog):
    keys = [c[0] for c in catalog]
    rows = []
    for _, r in frame.iterrows():
        rows.append({"participant": str(r["participant_id"]), "selected": r["participant_id"] == user,
                     "values": {k: _num(r[k]) for k in keys}})
    return rows


def _model_check(frame, user, variables):
    """Saved sleep / stress model against what the volunteer reported. Never raises: no model, no block."""
    by = {v["key"]: v for v in variables}
    row = data_store.mmash_row(user)
    if row is None:
        return None
    meta, metrics = ml_service._read_json("model_metadata.json"), ml_service._read_json("metrics.json")
    out = {"population": (meta.get("stress_ridge") or {}).get("population") or (meta.get("sleep_poor_logreg") or {}).get("population")}
    try:
        pred_stress = predict.predict_stress(row)
        pred_poor = predict.predict_sleep(row)
    except (FileNotFoundError, KeyError, ValueError):
        return None

    sm = metrics.get("stress_ridge") or {}
    reported = by.get("Daily_stress", {}).get("value")
    if reported is not None:
        miss = pred_stress - reported
        guess = sm.get("target_mean")
        out["stress"] = {
            "reported": reported, "predicted": float(pred_stress), "miss": float(miss),
            "typical_miss": sm.get("mae"), "cohort_spread": sm.get("target_sd"), "cohort_average": guess, "r2": sm.get("r2"),
            "miss_if_guessing_average": None if guess is None else float(abs(reported - guess)),
            "within_typical_miss": None if sm.get("mae") is None else bool(abs(miss) <= sm["mae"]),
            "warning": sm.get("warning"),
        }
    pm = metrics.get("sleep_poor_logreg") or {}
    psqi = by.get("Pittsburgh", {}).get("value")
    if psqi is not None:
        reported_poor = bool(psqi > PSQI_POOR)
        out["sleep"] = {
            "reported_psqi": psqi, "reported_poor": reported_poor, "predicted_poor_probability": float(pred_poor),
            "predicted_poor": bool(pred_poor > 0.5), "agrees": bool((pred_poor > 0.5) == reported_poor),
            "roc_auc": pm.get("roc_auc"), "warning": pm.get("warning"),
        }
    out["note"] = ("This volunteer was one of the 21 the models were trained on, so even a close match flatters the model. "
                   "The honest yardstick is the published miss (leave-one-out) in the numbers above.")
    return out if ("stress" in out or "sleep" in out) else None


def _p_text(p):
    return "p under 0.001" if p < 0.001 else f"p {p:.3f}"


def _reading(variables, pairs, model_check, n):
    cards = []
    by = {v["key"]: v for v in variables}
    judged = [v for v in variables if v["group"] == "mind" and v["higher_is_better"] is not None]
    for v in judged:
        hib = v["higher_is_better"]
        extreme = v["verdict"] in ("higher", "lower")
        if not extreme and not v["past_reference"]:
            continue
        if v["rank_from_top"] == 1 and n > 2:
            where = f"the highest of the {v['n']} volunteers"
        elif v["rank_from_top"] == v["n"] and n > 2:
            where = f"the lowest of the {v['n']} volunteers"
        else:
            where = f"above {round(v['higher_than'] * 100)}% of the other {v['n'] - 1} volunteers"
        worse = ((v["verdict"] == "higher") != hib) if extreme else True
        text = f"{v['value']:g} against a cohort middle of {v['middle']:g} (range {v['min']:g} to {v['max']:g}): {where}."
        if v["past_reference"]:
            text += f" It is past its reference line ({v['reference']['text']}), a screening line and not a diagnosis."
        cards.append({
            "tone": "warn" if worse else "ok",
            "title": f"{v['label']} is {v['verdict']} than most volunteers" if extreme else f"{v['label']} is past its reference line",
            "text": text, "evidence": "screening" if v["past_reference"] else "proxy",
        })
    if judged and not cards:
        cards.append({"tone": "ok", "title": "Every questionnaire score sits in the middle of the volunteer range",
                      "text": f"None of the {len(judged)} scores is in the top or bottom quarter of the {n} volunteers.", "evidence": "proxy"})

    # the strongest link for daily stress, said plainly, and an honest null when there is none
    if "Daily_stress" in by:
        links = []
        for p in pairs:
            if "Daily_stress" not in (p["a"], p["b"]):
                continue
            other = p["b"] if p["a"] == "Daily_stress" else p["a"]
            if other in by:
                links.append((other, p))
        tests = len(links)
        links.sort(key=lambda x: abs(x[1]["r"]), reverse=True)
        hit = next(((o, p) for o, p in links if abs(p["r"]) >= MEANINGFUL_R and p["p"] < ALPHA), None)
        if hit:
            o, p = hit
            cards.append({
                "tone": "mute",
                "title": f"In this cohort, daily stress goes with {by[o]['label']}",
                "text": (f"{'Higher' if p['r'] > 0 else 'Lower'} {by[o]['label']} went with higher daily stress "
                         f"(Spearman {p['r']:+.2f}, {_p_text(p['p'])}, {p['n']} volunteers). Exploratory: {tests} comparisons were run, "
                         f"so about {tests * ALPHA:.1f} would pass by chance alone."),
                "evidence": "weak",
            })
        elif tests:
            cards.append({"tone": "mute", "title": "Nothing in this cohort tracks daily stress closely",
                          "text": (f"None of the {tests} sleep, activity, HRV or questionnaire measures has a link with daily stress of "
                                   f"{MEANINGFUL_R:g} or more that is also under p {ALPHA}."),
                          "evidence": "weak"})

    s = (model_check or {}).get("stress")
    if s and s.get("typical_miss") is not None and s.get("cohort_spread") is not None:
        no_better = s.get("r2") is not None and s["r2"] <= 0
        cards.append({
            "tone": "warn" if no_better else "mute",
            "title": "The stress model is not better than the average" if no_better else "How far to trust the stress model",
            "text": (f"It predicted {s['predicted']:.0f} where {s['reported']:g} was reported. Its typical miss is {s['typical_miss']:g} points "
                     f"against a spread of {s['cohort_spread']:g} between volunteers. Use it only as a prompt to check in."),
            "evidence": "weak",
        })
    return cards


# ---------------------------------------------------------------------------------------------
def get_wellbeing_insight(req: DayRequest):
    chosen, _, _ = ml_service._merge_defaults(req)
    try:
        user = data_store.resolve_mmash_user(chosen.get("mmash_user"))
    except (data_store.DataNotFound, FileNotFoundError) as e:
        raise AppError(503, str(e)) from e
    selection = {"mmash_user": user}
    note = "Earth volunteers, not astronauts. Every comparison is against these volunteers only."
    disclaimer = "Research-data analysis, not a diagnosis or an astronaut-specific clinical prediction."
    if not user:
        return {"selection": selection, "mind": {"available": False, "reason": "No questionnaire volunteer is selected."}, "disclaimer": disclaimer}
    try:
        frame = _frame()
    except data_store.DataNotFound as e:
        return {"selection": selection, "mind": {"available": False, "reason": str(e)}, "disclaimer": disclaimer}
    if user not in set(frame["participant_id"]):
        return {"selection": selection, "mind": {"available": False, "reason": f"{user} has no complete questionnaire row."}, "disclaimer": disclaimer}

    catalog = _catalog(frame)
    variables = _variables(frame, user, catalog)
    if not any(v["group"] == "mind" for v in variables):
        return {"selection": selection, "mind": {"available": False, "reason": "No questionnaire scores were found in the data folder."}, "disclaimer": disclaimer}
    pairs = _pairs(frame, catalog)
    model_check = _model_check(frame, user, variables)
    n = int(frame["participant_id"].nunique())
    tests = max((sum(1 for p in pairs if "Daily_stress" in (p["a"], p["b"])), 0))
    return _clean({
        "selection": selection,
        "mind": {
            "available": True, "participant": user, "cohort_size": n,
            "variables": variables, "cohort": _cohort(frame, user, catalog), "pairs": pairs,
            "link_rule": {"meaningful_r": MEANINGFUL_R, "alpha": ALPHA, "min_n": MIN_PAIR_N, "comparisons_per_score": tests,
                          "expected_by_chance": tests * ALPHA,
                          "text": (f"A link is called worth reading when |Spearman rho| is {MEANINGFUL_R:g} or more and p is under {ALPHA}. "
                                   f"With {n} volunteers and many comparisons some links appear by chance, so treat every one as a lead, not a finding.")},
            "model_check": model_check,
            "reading": _reading(variables, pairs, model_check, n),
            "population_note": note,
        },
        "disclaimer": disclaimer,
    })
