"""Data-backed deep dive for AstroVital Vitals & Physical  (POST/GET /api/v1/ml/vitals-insight).

Rule of this module: nothing is typed in. The frontend only says WHICH data to look at
(hrv_user / mmash_user / blood_astronaut / timepoint). This module reads the data folder, runs the
saved models and returns plain numbers:

  hrv        every HRV window of the checked day with its own model score, the volunteer reference
             band per measure, what drives an unusual result, how long it lasts, where this
             volunteer sits among all volunteers
  blood      every Inspiration4 blood value for the whole mission against the astronaut's OWN
             pre-flight range, recovery outlook (straight line, no hindsight), crew context
  activity   steps / heart rate / movement of the selected volunteer vs all volunteers
  vital_references  the reference limits of the backend risk engine (rules.py) for the vital signs

Nothing here changes the Green / Amber / Red level. That stays in app/ml/predict.py.
"""
import math
import re
from statistics import median

import numpy as np
import pandas as pd

from app.core.exceptions import AppError
from app.ml import data_store, predict
from app.risk_engine import rules

# ---- design choices (written here so the team can read and change them) ----------------------
MOVE_MIN_PCT = 5.0            # a blood value must be >= 5% from the pre-flight mean to count as "outside" (lab noise below)
REF_LOW, REF_HIGH = 0.05, 0.95  # volunteer reference band for the HRV measures (5th to 95th percentile)
HRV_FLAG_SHARE = 0.10         # same line as predict.astrovital_flag: unusual HRV in over 10% of windows
STEPS_FLAG = 5000             # same line as predict.astrovital_flag: steps under 5,000 = proxy flag
SUSTAINED_RUN = 3             # this many unusual windows in a row = "sustained, not a blip"
STEADY_PCT_POINTS = 2.0       # a value that moved less than this (percentage points) between samples is "steady"
LONG_RECOVERY_DAYS = 365      # a straight-line recovery estimate beyond this is reported as "over a year"
VITAL_METRICS = ("heart_rate_bpm", "spo2_percent", "body_temperature_c", "systolic_bp", "diastolic_bp")

HRV_MEASURES = [  # (short key, column in the HRV file, label, unit)
    ("hr", "mean_hr_bpm", "Mean heart rate", "bpm"),
    ("sdnn", "rr_sdnn_ms", "SDNN (overall variability)", "ms"),
    ("rmssd", "rr_rmssd_ms", "RMSSD (beat-to-beat variability)", "ms"),
    ("pnn50", "rr_pnn50_percent", "pNN50 (large beat changes)", "%"),
]

ACTIVITY_METRICS = [  # (label, column or None = steps per recorded day, unit)
    ("Steps per recorded day", None, "steps/day"),
    ("Mean heart rate", "screened_mean_bpm", "bpm"),
    ("Movement magnitude", "mean_vector_magnitude", "dataset units"),
    ("Standing observations", "standing_observations", "observations"),
    ("Sitting observations", "sitting_observations", "observations"),
    ("Lying observations", "lying_observations", "observations"),
]

_UNITS = [  # longest first, so the eGFR unit is not cut short
    ("milliliter_per_minute_per_1.73_meter_squared", "mL/min/1.73m²"),
    ("thousand_per_microliter", "K/µL"), ("million_per_microliter", "M/µL"), ("cells_per_microliter", "cells/µL"),
    ("milligram_per_deciliter", "mg/dL"), ("grams_per_deciliter", "g/dL"), ("gram_per_deciliter", "g/dL"),
    ("millimol_per_liter", "mmol/L"), ("units_per_liter", "U/L"),
    ("picogram", "pg"), ("femtoliter", "fL"), ("percent", "%"),
]
_ACRONYMS = {"alt": "ALT", "ast": "AST", "bun": "BUN", "mch": "MCH", "mchc": "MCHC", "mcv": "MCV",
             "mpv": "MPV", "rdw": "RDW", "egfr": "eGFR"}
_PANELS = {"serum": "chemistry", "cbc": "cbc"}


# ---------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------
def _clean(obj):
    """numpy -> plain python, NaN / inf -> None (JSON cannot carry them)."""
    if isinstance(obj, dict):
        return {str(k): _clean(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_clean(v) for v in obj]
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating, float)):
        return float(obj) if math.isfinite(float(obj)) else None
    if obj is None or (not isinstance(obj, (str, bytes)) and pd.isna(obj)):
        return None
    return obj


def _num(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def _share_below(values, x):
    """Share (0-1) of `values` that are strictly below x. None if there is nothing to compare with."""
    vals = [v for v in values if v is not None]
    return float(np.mean([v < x for v in vals])) if vals else None


def _tp_order(tp):
    m = re.match(r"^L-(\d+)$", str(tp))
    if m:
        return (0, -int(m.group(1)))
    m = re.match(r"^R\+(\d+)$", str(tp))
    if m:
        return (1, int(m.group(1)))
    return (2, str(tp))


def _tp_day(tp):
    """Signed mission day of a timepoint: L-92 -> -92, R+45 -> 45. None for unknown formats."""
    m = re.match(r"^([LR])([+-])(\d+)$", str(tp))
    if not m:
        return None
    n = int(m.group(3))
    return -n if m.group(1) == "L" else n


def _tp_text(tp):
    d = _tp_day(tp)
    if d is None:
        return str(tp)
    n = abs(d)
    unit = "day" if n == 1 else "days"
    return f"{n} {unit} before launch" if d < 0 else f"{n} {unit} after landing"


def _is_post(tp):
    return str(tp).startswith("R")


# ---------------------------------------------------------------------------------------------
# HRV
# ---------------------------------------------------------------------------------------------
def _longest_run(flags):
    best = cur = 0
    best_start = start = None
    for i, f in enumerate(flags):
        if f:
            if cur == 0:
                start = i
            cur += 1
            if cur > best:
                best, best_start = cur, start
        else:
            cur = 0
    return best, best_start


def _hrv(user):
    if not user:
        return {"available": False, "reason": "No HRV participant selected."}
    try:
        data = data_store._read("hrv")
    except data_store.DataNotFound as e:
        return {"available": False, "reason": str(e)}
    rows = data_store.hrv_windows(user)  # the same windows that sit behind today's status
    if rows is None:
        return {"available": False, "reason": "No eligible HRV windows found for this participant."}
    rows = rows.dropna(subset=data_store.HRV_COLS).sort_values("window_number").copy()
    if rows.empty:
        return {"available": False, "reason": "No complete HRV windows found for this participant."}

    model = predict.require_model("hrv_anomaly_isoforest")
    cols = predict._features(model) or data_store.HRV_COLS
    missing = [c for c in cols if c not in rows.columns]
    if missing:
        raise AppError(503, f"HRV file is missing {len(missing)} saved-model features.")
    rows["unusual"] = model.predict(rows[cols]) == -1
    try:
        rows["score"] = model.decision_function(rows[cols])
    except Exception:  # noqa: BLE001  model without decision_function: keep the flag, drop the score
        rows["score"] = np.nan

    eligible = data[data.eligible == True].dropna(subset=data_store.HRV_COLS)  # noqa: E712
    total_eligible = int((eligible.participant_id == user).sum())
    broken = data_store._unit_problem_participants(data)  # sensor / unit problem volunteers, found from the data
    ref = eligible[(eligible.participant_id != user) & (~eligible.participant_id.isin(broken))]

    measures = []
    for key, col, label, unit in HRV_MEASURES:
        ref_vals = pd.to_numeric(ref[col], errors="coerce").dropna()
        own = pd.to_numeric(rows[col], errors="coerce").dropna()
        lo, mid, hi = (float(ref_vals.quantile(q)) for q in (REF_LOW, 0.5, REF_HIGH)) if len(ref_vals) else (None, None, None)
        med = float(own.median())
        outside = float(((own < lo) | (own > hi)).mean()) if lo is not None else None
        verdict = None
        if lo is not None:
            verdict = "higher" if med > hi else "lower" if med < lo else "similar"
        measures.append({
            "key": key, "column": col, "label": label, "unit": unit,
            "median": med, "minimum": float(own.min()), "maximum": float(own.max()),
            "reference_low": lo, "reference_middle": mid, "reference_high": hi,
            "share_windows_outside_band": outside,
            "difference_pct": ((med - mid) / abs(mid) * 100) if mid else None,
            "verdict": verdict,
        })

    windows = [{
        "window": int(r.window_number) + 1,
        "elapsed_minutes": float(r.window_start_elapsed_s) / 60,
        **{col: float(r[col]) for _, col, _, _ in HRV_MEASURES},
        "score": _num(r.score), "unusual": bool(r.unusual),
    } for _, r in rows.iterrows()]

    flags = rows.unusual.tolist()
    run_len, run_start = _longest_run(flags)
    n = len(rows)

    # Where this volunteer sits: unusual-window share over the whole recording, every volunteer.
    by_user = data_store._hrv_anomaly_by_user()
    others = [float(v) for k, v in by_user.items() if k != user]
    own_share = float(by_user.get(user)) if user in by_user.index else None
    volunteers = [{"participant": str(k), "unusual_fraction": float(v), "selected": k == user}
                  for k, v in by_user.items()]
    sits = {
        "volunteers": volunteers, "n_volunteers": len(volunteers), "selected_fraction": own_share,
        "volunteer_middle": float(median(others)) if others else None,
        "more_unusual_than": _share_below(others, own_share) if own_share is not None else None,
        "flag_line": HRV_FLAG_SHARE,
    }

    artefact = user in broken
    reading = []
    if artefact:
        reading.append({"tone": "bad", "title": "Possible sensor artefact.",
                        "text": "Variability sits far above every other volunteer. Very high variability is more often a loose sensor, "
                                "extra beats or a unit problem than a healthy rhythm. The model was trained with one such volunteer left out. "
                                "Re-fit the sensor and check the next window before acting on it."})
    if run_len >= SUSTAINED_RUN:
        reading.append({"tone": "warn", "title": "Sustained, not a blip.",
                        "text": f"{run_len} unusual windows in a row, starting at window {run_start + 1}. A run is more meaningful than scattered single windows."})
    elif int(rows.unusual.sum()) > 0:
        reading.append({"tone": "warn", "title": "Scattered, not sustained.",
                        "text": f"{int(rows.unusual.sum())} unusual window(s) but no run of {SUSTAINED_RUN} or more in a row. Check whether the next windows return to the usual range."})
    else:
        reading.append({"tone": "ok", "title": "No unusual window.",
                        "text": "Every checked window looks like the other volunteers' windows to the saved model."})

    return _clean({
        "available": True, "participant": user, "windows": windows,
        "windows_checked": n, "windows_eligible_total": total_eligible,
        "unusual_windows": int(rows.unusual.sum()), "anomaly_fraction": float(rows.unusual.mean()),
        "normal_fraction": float(1 - rows.unusual.mean()),
        "longest_unusual_run": run_len, "longest_run_start_window": (run_start + 1) if run_start is not None else None,
        "measures": measures, "volunteer_sits": sits, "reading": reading, "sensor_artefact": artefact,
        "reference": {"windows": int(len(ref)), "volunteers": int(ref.participant_id.nunique()),
                      "low_quantile": REF_LOW, "high_quantile": REF_HIGH,
                      "left_out_for_sensor": [str(b) for b in broken if b != user]},
        "model_note": "The detector is trained on Earth volunteers, not astronauts.",
        "note": "Elapsed windows belong to one recording; they are not calendar-day observations.",
    })


# ---------------------------------------------------------------------------------------------
# Blood
# ---------------------------------------------------------------------------------------------
def _describe_column(col):
    """'serum__alt_value_units_per_liter' -> panel, label, unit. All parsed from the column name."""
    prefix, _, rest = col.partition("__")
    panel = _PANELS.get(prefix, prefix)
    name, _, unit_part = rest.partition("_value")
    unit_part = unit_part.lstrip("_")
    unit = next((u for raw, u in _UNITS if unit_part == raw), unit_part.replace("_", " ") or ("ratio" if "ratio" in name else ""))
    words = name.replace("_", " ").split()
    label = " ".join(_ACRONYMS.get(w, w) for w in words)
    label = label[0].upper() + label[1:] if label else col
    return panel, label, unit


def _pct(value, base):
    if value is None or base in (None, 0):
        return None
    return (value - base) / abs(base) * 100


def _crew_changes(frame, astronaut_ids, cols):
    """{astronaut: {tp: {col: pct change vs that astronaut's own pre-flight mean}}}"""
    out = {}
    for a in astronaut_ids:
        mine = frame[frame.astronaut == a]
        pre = mine[~mine.timepoint.astype(str).map(_is_post)]
        base = {c: _num(pd.to_numeric(pre[c], errors="coerce").mean()) for c in cols}
        out[a] = {}
        for _, r in mine.iterrows():
            out[a][r.timepoint] = {c: _pct(_num(r[c]), base[c]) for c in cols}
    return out


def _blood(astronaut):
    if not astronaut:
        return {"available": False, "reason": "No Inspiration4 astronaut selected."}
    try:
        data = data_store._read("insp4")
    except data_store.DataNotFound as e:
        return {"available": False, "reason": str(e)}
    mine = data[data.astronaut == astronaut].copy()
    if mine.empty:
        return {"available": False, "reason": "No records for this astronaut."}
    model = predict.require_model("insp4_postflight_logreg")
    cols = predict._features(model) or []
    cols = [c for c in cols if c in data.columns]
    tps = sorted(mine.timepoint.dropna().unique().tolist(), key=_tp_order)
    pre_tps = [t for t in tps if not _is_post(t)]
    post_tps = [t for t in tps if _is_post(t)]
    if not pre_tps:
        return {"available": False, "reason": "No pre-flight (L-) samples, so there is no own baseline."}
    if not post_tps:
        return {"available": False, "reason": "No post-flight (R+) samples yet."}

    pre = mine[mine.timepoint.isin(pre_tps)]
    crew_ids = sorted(data.astronaut.unique().tolist())
    changes = _crew_changes(data, crew_ids, cols)
    other_ids = [a for a in crew_ids if a != astronaut]

    values = []
    for c in cols:
        panel, label, unit = _describe_column(c)
        pv = pd.to_numeric(pre[c], errors="coerce").dropna()
        if pv.empty:
            continue
        lo, hi, mean_ = float(pv.min()), float(pv.max()), float(pv.mean())
        samples = []
        for tp in tps:
            r = mine[mine.timepoint == tp].iloc[0]
            v = _num(r[c])
            pct = _pct(v, mean_)
            if not _is_post(tp):
                status = "baseline"
            elif v is None or pct is None:
                status = "missing"
            elif (v < lo or v > hi) and abs(pct) >= MOVE_MIN_PCT:
                status = "below" if v < lo else "above"
            else:
                status = "inside"
            # Other crew members' median % change vs their own pre-flight mean at this same sample.
            # Computed for every timepoint (pre-flight included), not only post-flight ones.
            crew_vals = [changes[a].get(tp, {}).get(c) for a in other_ids]
            crew_vals = [x for x in crew_vals if x is not None]
            samples.append({"timepoint": tp, "when": _tp_text(tp), "value": v, "pct": pct, "status": status,
                            "crew_median_pct": float(median(crew_vals)) if crew_vals else None})
        values.append({"column": c, "panel": panel, "label": label, "unit": unit,
                       "own_low": lo, "own_high": hi, "own_mean": mean_, "samples": samples})
    if not values:
        return {"available": False, "reason": "No measured blood values with a pre-flight baseline."}

    def sample(v, tp):
        return next(s for s in v["samples"] if s["timepoint"] == tp)

    def outside(s):
        return s["status"] in ("below", "above")

    per_tp = []
    for tp in post_tps:
        row = {"timepoint": tp, "when": _tp_text(tp), "measured": 0, "outside": 0, "by_panel": {}}
        for v in values:
            s = sample(v, tp)
            if s["status"] == "missing":
                continue
            row["measured"] += 1
            p = row["by_panel"].setdefault(v["panel"], {"measured": 0, "outside": 0})
            p["measured"] += 1
            if outside(s):
                row["outside"] += 1
                p["outside"] += 1
        per_tp.append(row)

    peak = max(per_tp, key=lambda r: (r["outside"], -post_tps.index(r["timepoint"])))["timepoint"]
    last = post_tps[-1]
    peak_i = post_tps.index(peak)

    for v in values:
        v["peak_pct"] = sample(v, peak)["pct"]
    values.sort(key=lambda v: abs(v["peak_pct"]) if v["peak_pct"] is not None else -1, reverse=True)

    # ---- recovery outlook: only samples up to the peak are used (no hindsight) -------------------
    outlook, counts = [], {"improving": 0, "steady": 0, "moving_away": 0, "needs_second_sample": 0}
    for v in values:
        s_peak = sample(v, peak)
        if not outside(s_peak):
            continue
        history = [(_tp_day(t), sample(v, t)["pct"]) for t in post_tps[: peak_i + 1]]
        history = [(d, p) for d, p in history if d is not None and p is not None]
        trend, back_in_days = "first_sample", None
        slope = None
        if len(history) >= 2:
            xs, ys = [h[0] for h in history], [abs(h[1]) for h in history]
            slope = float(np.polyfit(xs, ys, 1)[0])
            span = ys[-1] - ys[0]
            if abs(span) < STEADY_PCT_POINTS:
                trend = "steady"
            elif slope < 0:
                trend = "improving"
                days = (ys[-1] - MOVE_MIN_PCT) / -slope
                back_in_days = "over a year" if days > LONG_RECOVERY_DAYS else round(max(0.0, days), 1)
            else:
                trend = "moving_away"
        counts[{"first_sample": "needs_second_sample"}.get(trend, trend)] += 1
        nxt = next((t for t in post_tps[peak_i + 1:]), None)
        nxt_info = None
        if nxt:
            s_next = sample(v, nxt)
            projected = None
            if slope is not None and s_peak["pct"] is not None and trend != "steady":
                sign = 1 if s_peak["pct"] >= 0 else -1
                projected = sign * max(0.0, abs(s_peak["pct"]) + slope * (_tp_day(nxt) - _tp_day(peak)))
            nxt_info = {"timepoint": nxt, "pct": s_next["pct"], "status": s_next["status"], "projected_pct": projected}
        outlook.append({"label": v["label"], "unit": v["unit"], "panel": v["panel"], "now_pct": s_peak["pct"],
                        "trend": trend, "back_in_range_days": back_in_days, "next_sample": nxt_info})
    outlook.sort(key=lambda o: abs(o["now_pct"]) if o["now_pct"] is not None else -1, reverse=True)

    left_at_peak = [v for v in values if outside(sample(v, peak))]
    back_by_last = [v for v in left_at_peak if not outside(sample(v, last))]

    # ---- crew context: same sample for every astronaut, both blood models ------------------------
    osd = None
    try:
        osd = data_store._read("osd571")
    except data_store.DataNotFound:
        pass

    def model_prob(fn, frame, a):
        if frame is None:
            return None
        row = frame[(frame.astronaut == a) & (frame.timepoint == peak)]
        if row.empty:
            return None
        try:
            return float(fn(row.iloc[[0]]))
        except Exception:  # noqa: BLE001  missing values for this sample: no score instead of a guess
            return None

    crew = []
    for a in crew_ids:
        base = {c: None for c in cols}
        mine_a = data[data.astronaut == a]
        pre_a = mine_a[~mine_a.timepoint.astype(str).map(_is_post)]
        n_out = n_meas = 0
        row_a = mine_a[mine_a.timepoint == peak]
        if not row_a.empty and not pre_a.empty:
            for c in cols:
                pv = pd.to_numeric(pre_a[c], errors="coerce").dropna()
                v = _num(row_a.iloc[0][c])
                if pv.empty or v is None:
                    continue
                m_ = float(pv.mean())
                pct = _pct(v, m_)
                if pct is None:
                    continue
                n_meas += 1
                if (v < pv.min() or v > pv.max()) and abs(pct) >= MOVE_MIN_PCT:
                    n_out += 1
        crew.append({"astronaut": a, "selected": a == astronaut, "outside": n_out, "measured": n_meas,
                     "cbc_model_probability": model_prob(predict.predict_blood_insp4, data, a),
                     "metabolite_model_probability": model_prob(predict.predict_blood_osd571, osd, a)})
    others_out = [c["outside"] for c in crew if not c["selected"]]
    mine_out = next(c["outside"] for c in crew if c["selected"])
    position = None
    if others_out:
        position = "higher" if mine_out > max(others_out) else "lower" if mine_out < min(others_out) else "typical"

    panels = sorted({v["panel"] for v in values}, key=lambda p: (p != "chemistry", p))
    return _clean({
        "available": True, "astronaut": astronaut, "timepoints": tps, "post_timepoints": post_tps,
        "timepoint_labels": {t: _tp_text(t) for t in tps},
        "peak_timepoint": peak, "last_timepoint": last, "panels": panels,
        "values": values, "per_timepoint": per_tp,
        "peak": {"timepoint": peak, "when": _tp_text(peak), "outside": next(r["outside"] for r in per_tp if r["timepoint"] == peak),
                 "measured": next(r["measured"] for r in per_tp if r["timepoint"] == peak),
                 "biggest": {"label": values[0]["label"], "pct": values[0]["peak_pct"]}},
        "recovery": {"left_range_at_peak": len(left_at_peak), "back_in_range_by_last": len(back_by_last), "last_timepoint": last},
        "outlook": {"rows": outlook, "counts": counts,
                    "method": "Straight-line estimate from the post-flight samples up to the peak sample, with no hindsight. "
                              "Use it to decide what to re-check, not to promise a date."},
        "crew": {"rows": crew, "peak_timepoint": peak, "others_middle": float(median(others_out)) if others_out else None,
                 "position": position,
                 "note": "Both blood models were trained on these same crew, so this is a proof-of-concept comparison, not a test on unseen astronauts."},
        "rule": {"move_min_pct": MOVE_MIN_PCT,
                 "text": f"Own range = lowest to highest of this astronaut's pre-flight samples. A value counts as outside only if it is beyond that range "
                         f"AND at least {MOVE_MIN_PCT:g}% away from the pre-flight mean (smaller moves are lab noise). Design choice, not a clinical limit."},
    })


# ---------------------------------------------------------------------------------------------
# Activity
# ---------------------------------------------------------------------------------------------
def _activity(user):
    if not user:
        return {"available": False, "reason": "No MMASH participant selected."}
    try:
        data = data_store._read("activity")
    except data_store.DataNotFound as e:
        return {"available": False, "reason": str(e)}
    data = data.copy()
    row = data[data.participant_id == user]
    if row.empty:
        return {"available": False, "reason": "No activity record for the selected participant."}
    data["steps_day"] = np.where(data.recorded_days > 0, data.total_steps / data.recorded_days, np.nan)

    metrics = []
    for label, col, unit in ACTIVITY_METRICS:
        series = pd.to_numeric(data["steps_day" if col is None else col], errors="coerce")
        valid = data.assign(_v=series).dropna(subset=["_v"])
        mine_v = _num(valid.loc[valid.participant_id == user, "_v"].iloc[0]) if (valid.participant_id == user).any() else None
        others = valid.loc[valid.participant_id != user, "_v"].tolist()
        metrics.append({
            "label": label, "unit": unit, "value": mine_v, "cohort_n": int(len(valid)),
            "cohort_middle": float(valid["_v"].median()) if len(valid) else None,
            "cohort_min": float(valid["_v"].min()) if len(valid) else None,
            "cohort_max": float(valid["_v"].max()) if len(valid) else None,
            "higher_than": _share_below(others, mine_v) if mine_v is not None else None,
        })
    steps = data.dropna(subset=["steps_day"])
    return _clean({
        "available": True, "participant": user, "recorded_days": row.iloc[0].recorded_days,
        "cohort_size": int(data.participant_id.nunique()), "metrics": metrics,
        "steps_by_volunteer": sorted(
            [{"participant": str(r.participant_id), "steps_per_day": float(r.steps_day), "selected": r.participant_id == user}
             for r in steps.itertuples()], key=lambda x: x["steps_per_day"]),
        "steps_flag": STEPS_FLAG,
    })


# ---------------------------------------------------------------------------------------------
# Vital sign reference limits (read from the backend risk engine, never typed in the frontend)
# ---------------------------------------------------------------------------------------------
def _vital_references():
    out = {}
    for r in rules.RULES:
        if r.metric not in VITAL_METRICS:
            continue
        high = [t for t in r.tiers if t.op in ("gt", "ge")]
        low = [t for t in r.tiers if t.op in ("lt", "le")]
        lim_hi = min(t.threshold for t in high) if high else None
        lim_lo = max(t.threshold for t in low) if low else None
        if lim_lo is None and lim_hi is not None and r.metric == "heart_rate_bpm":
            m = re.search(r"(\d+)\s*-\s*(\d+)\s*bpm", r.source)  # "normal adult resting HR 60-100 bpm"
            lim_lo = float(m.group(1)) if m else None
        if lim_lo is not None and lim_hi is not None:
            text = f"inside {lim_lo:g}–{lim_hi:g}"
        elif lim_hi is not None:
            text = f"under {lim_hi:g}"
        elif lim_lo is not None:
            text = f"normal ({lim_lo:g} or more)"
        else:
            continue
        out[r.metric] = {"low": lim_lo, "high": lim_hi, "text": text, "source": r.source, "evidence": r.evidence,
                         "high_is_inclusive_flag": bool(high and min(high, key=lambda t: t.threshold).op == "ge")}
    return out


# ---------------------------------------------------------------------------------------------
def get_vitals_insight(req):
    from app.services.ml_service import _merge_defaults
    chosen, _, _ = _merge_defaults(req)
    try:
        hrv_user = data_store.resolve_hrv_user(chosen.get("hrv_user"))
        mmash_user = data_store.resolve_mmash_user(chosen.get("mmash_user"))
    except (data_store.DataNotFound, FileNotFoundError) as e:
        raise AppError(503, str(e)) from e
    return _clean({
        "selection": {"hrv_user": hrv_user, "mmash_user": mmash_user,
                      "blood_astronaut": chosen.get("blood_astronaut"), "timepoint": chosen.get("timepoint")},
        "hrv": _hrv(hrv_user),
        "blood": _blood(chosen.get("blood_astronaut")),
        "activity": _activity(mmash_user),
        "vital_references": _vital_references(),
        "flag_lines": {"hrv_unusual_share": HRV_FLAG_SHARE, "steps_per_day": STEPS_FLAG, "blood_move_pct": MOVE_MIN_PCT},
        "time_ranges": {
            "reason": "HRV windows come from one recording, so there is no 7-day or 30-day view of them. "
                      "The 7 and 30-day vital-sign trends come from the stored Daily Check-in readings."},
        "disclaimer": "Research-data analysis, not a diagnosis or an astronaut-specific clinical prediction.",
    })