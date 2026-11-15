"""Deep-dive numbers for the Sleep Tracker page (POST /api/v1/ml/sleep-insight).

Same rule as the other insight services: nothing is typed in and nothing is guessed. The frontend only says WHICH
data to look at (astronaut, and the MMASH volunteer via scenario / subject / mmash_user). Two real sources:

  log   the astronaut's own nights, stored through Daily Check-in (observations.sleep_hours, with the sleep-quality
        rating, heart rate, blood pressure, SpO2, temperature and cognitive tests recorded on the same days)
          nightly      hours per night, band against the backend sleep rule, 7-night average, rating
          debt         running balance against the recommended hours, shortfall of the last 7 nights
          runs         nights short in a row (now / longest) and longest run meeting the guideline
          regularity   spread of nightly hours, own usual range, night-to-night swing, steadier or more erratic,
                       and whether a short night is followed by a longer one (catch-up)
          rating       hours against the sleep-quality rating (long but not restful, short but felt fine)
          cost         heart rate, blood pressure, SpO2, temperature and cognitive tests on days after a short
                       night against days after a night that met the guideline
  lab   one MMASH volunteer's measured night against 21 volunteers
          variables    time asleep, efficiency, time awake, awakenings, fragmentation, average wake bout
          profile      short / low efficiency / fragmented flags for this night
          perception   what the volunteer's own sleep questionnaire (PSQI) says against what was measured
          split        the better-sleeping half of the cohort against the other half: recovery, activity, stress
          drivers      why the saved poor-sleep model said what it said (each input's push, in log-odds)

A block that cannot be computed (too few nights, no file) is left out of the answer, never filled with a default.
Thresholds already in the backend are reused as they are (app/risk_engine/rules.py SLEEP_LOW; the model files). The
extra design choices are written below so the team can read and change them.
Nothing here changes the Good / Warning / Critical level (that stays in app/ml/predict.py) and nothing is a diagnosis.
The cohort is 21 healthy young men on Earth, one night each, not astronauts: every comparison is "against these volunteers".
"""
import math
from collections import defaultdict
from datetime import UTC, datetime, timedelta
from statistics import mean, median, pstdev

import numpy as np
import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.ml import data_store, predict
from app.models.observation import Observation
from app.repositories import astronaut_repo, wellbeing_repo
from app.risk_engine.rules import RULES
from app.schemas.ml import DayRequest, SleepInsightRequest
from app.schemas.observation import to_utc
from app.services import ml_service
from app.services import wellbeing_insight_service as wb
from app.services.vitals_insight_service import _clean, _num, _share_below

# ---- design choices (written here so the team can read and change them) ---------------------
MIN_NIGHTS = 3             # nights needed before the log section appears at all
MIN_FOR_USUAL = 5          # earlier nights needed before "your usual range" is drawn
SD_FLOOR = 0.25            # hours: a flat history still gets a usable spread
Z_OUTSIDE = 1.0            # more than 1 SD from the usual mean = outside the astronaut's own usual range
MIN_PER_GROUP = 3          # short-night comparisons need this many days in each group
MIN_FOR_RATING = 6         # nights with both hours and a rating before they are compared
QUALITY_OK = 6             # a rating of 6/10 or more counts as "rated well" (scale is 0-10)
HALF_MIN = 4               # nights in each half before steadier / more erratic is judged
REBOUND_GAIN = 0.5         # hours: the night after a short night must be this much longer to count as catching up
EFFECT_NOTICEABLE = 0.5    # difference of half a spread (pooled SD) or more is called noticeable
HIGH_SHARE, LOW_SHARE = wb.HIGH_SHARE, wb.LOW_SHARE
EFFICIENCY_LINE = 85       # sleep efficiency under 85% is the usual clinical line for poor efficiency
WASO_LINE = 30             # more than 30 min awake after falling asleep is the usual line for disturbed sleep
MIN_SPLIT_N = 4            # volunteers needed in each half of the cohort split

_SLEEP_RULE = next(r for r in RULES if r.code == "SLEEP_LOW")
TARGET_HOURS = max(t.threshold for t in _SLEEP_RULE.tiers)           # 7 h, from the backend rule

OBS_METRICS = [  # (field, label, unit, higher_is_better)
    ("heart_rate_bpm", "Heart rate", "bpm", False),
    ("systolic_bp", "Systolic blood pressure", "mmHg", False),
    ("diastolic_bp", "Diastolic blood pressure", "mmHg", False),
    ("spo2_percent", "SpO2", "%", True),
    ("body_temperature_c", "Body temperature", "C", None),
]
COG_METRICS = [
    ("reaction_time_ms", "Reaction time", "ms", False),
    ("attention_score", "Attention", "/100", True),
    ("memory_score", "Memory", "/100", True),
    ("task_accuracy", "Task accuracy", "%", True),
]


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------
def _r(x, nd=2):
    return None if x is None or not math.isfinite(float(x)) else round(float(x), nd)


def _band(hours):
    """Band of one night from the backend sleep rule: severe / inadequate / below / ok."""
    tier = _SLEEP_RULE.match(hours)
    if tier is None:
        return "ok"
    ordered = list(_SLEEP_RULE.tiers)
    return ("severe", "inadequate", "below")[min(ordered.index(tier), 2)]


BAND_TEXT = {"severe": "severely short", "inadequate": "inadequate", "below": "below recommended", "ok": "meets the guideline"}


def _hm(hours):
    m = int(round(hours * 60))
    return f"{m // 60} h {m % 60:02d} min"


def _spearman(xs, ys):
    if len(xs) < 4 or len(set(xs)) < 2 or len(set(ys)) < 2:
        return None
    try:
        from scipy.stats import spearmanr
        res = spearmanr(xs, ys)
        r, p = float(res.statistic), float(res.pvalue)
    except Exception:  # noqa: BLE001  no scipy: no correlation instead of a made-up one
        return None
    return (r, p) if math.isfinite(r) and math.isfinite(p) else None


def _runs(flags, dates):
    """(current_run, longest_run) of True flags over consecutive calendar days, newest last."""
    cur = best = 0
    prev = None
    for f, d in zip(flags, dates):
        if f:
            cur = cur + 1 if (prev is not None and (d - prev).days == 1 and cur > 0) else 1
        else:
            cur = 0
        best = max(best, cur)
        prev = d
    return cur, best


# ---------------------------------------------------------------------------------------------
# A. the astronaut's own nights
# ---------------------------------------------------------------------------------------------
def _log_block(db: Session, astronaut_id: int, days: int):
    newest = db.scalar(select(Observation).where(Observation.astronaut_id == astronaut_id, Observation.sleep_hours.is_not(None))
                       .order_by(Observation.observed_at.desc(), Observation.id.desc()).limit(1))
    if newest is None:
        return None
    end = to_utc(newest.observed_at)
    start = end - timedelta(days=days)
    obs = list(db.scalars(select(Observation).where(Observation.astronaut_id == astronaut_id, Observation.observed_at >= start,
                                                    Observation.observed_at <= end).order_by(Observation.observed_at, Observation.id)))
    per = defaultdict(lambda: defaultdict(list))
    for o in obs:
        d = to_utc(o.observed_at).date()
        for f in ["sleep_hours"] + [m[0] for m in OBS_METRICS]:
            v = getattr(o, f)
            if v is not None:
                per[d][f].append(float(v))
    wb_rows = wellbeing_repo.in_window(db, astronaut_id, start, end)
    quality = defaultdict(list)
    for a in wb_rows:
        quality[to_utc(a.assessed_at).date()].append(float(a.sleep_quality))
    cog = defaultdict(lambda: defaultdict(list))
    for c in wellbeing_repo.all_cognitive(db, astronaut_id):
        t = to_utc(c.assessed_at)
        if start <= t <= end:
            for f, *_ in COG_METRICS:
                v = getattr(c, f)
                if v is not None:
                    cog[t.date()][f].append(float(v))

    nights_d = sorted(d for d in per if per[d]["sleep_hours"])
    if len(nights_d) < MIN_NIGHTS:
        return {"available": False, "nights": len(nights_d), "needed": MIN_NIGHTS,
                "reason": f"{len(nights_d)} night{'s' if len(nights_d) != 1 else ''} with hours logged so far; {MIN_NIGHTS} are needed."}
    hours = {d: mean(per[d]["sleep_hours"]) for d in nights_d}
    vals = [hours[d] for d in nights_d]
    bands = [_band(h) for h in vals]

    nightly = []
    for i, d in enumerate(nights_d):
        win = [hours[x] for x in nights_d if 0 <= (d - x).days < 7]
        nightly.append({"date": d.isoformat(), "hours": _r(vals[i]), "band": bands[i],
                        "avg7": _r(mean(win)) if len(win) >= 3 else None,
                        "rating": _r(mean(quality[d]), 1) if quality.get(d) else None})

    short_flags = [b != "ok" for b in bands]
    cur_short, long_short = _runs(short_flags, nights_d)
    _cur_ok, long_ok = _runs([not f for f in short_flags], nights_d)
    latest_h, latest_d = vals[-1], nights_d[-1]

    # usual range from the EARLIER nights, so last night is not compared with itself
    prev = vals[:-1]
    usual = None
    if len(prev) >= MIN_FOR_USUAL:
        m, sd = mean(prev), max(pstdev(prev), SD_FLOOR)
        z = (latest_h - m) / sd
        usual = {"mean": _r(m, 1), "sd": _r(sd), "n": len(prev), "low": _r(max(0, m - sd * Z_OUTSIDE), 1), "high": _r(min(24, m + sd * Z_OUTSIDE), 1),
                 "latest_z": _r(z), "latest_difference": _r(latest_h - m), "latest_vs_usual": "above" if z > Z_OUTSIDE else "below" if z < -Z_OUTSIDE else "typical"}

    summary = {
        "nights": len(vals), "mean": _r(mean(vals)), "median": _r(median(vals)), "min": _r(min(vals)), "max": _r(max(vals)),
        "sd": _r(pstdev(vals)) if len(vals) > 1 else None,
        "shortest": {"date": nights_d[vals.index(min(vals))].isoformat(), "hours": _r(min(vals))},
        "longest": {"date": nights_d[vals.index(max(vals))].isoformat(), "hours": _r(max(vals))},
        "nights_below_guideline": sum(short_flags), "share_below_guideline": _r(sum(short_flags) / len(vals)),
        "nights_inadequate_or_worse": sum(b in ("severe", "inadequate") for b in bands),
        "nights_severe": sum(b == "severe" for b in bands),
        "current_short_run": cur_short, "longest_short_run": long_short, "longest_ok_run": long_ok,
        "last_night": {"date": latest_d.isoformat(), "hours": _r(latest_h), "band": bands[-1], "usual": usual},
        "bands": {k: bands.count(k) for k in ("severe", "inadequate", "below", "ok")},
    }

    # running balance against the recommended hours (only nights that were logged count)
    bal, cum = 0.0, []
    for d, h in zip(nights_d, vals):
        bal += h - TARGET_HOURS
        cum.append({"date": d.isoformat(), "balance": _r(bal)})
    last7 = [d for d in nights_d if 0 <= (latest_d - d).days < 7]
    debt = {"target_hours": TARGET_HOURS, "net_hours": _r(bal), "short_hours_total": _r(sum(max(0, TARGET_HOURS - h) for h in vals)),
            "extra_hours_total": _r(sum(max(0, h - TARGET_HOURS) for h in vals)),
            "short_hours_last7": _r(sum(max(0, TARGET_HOURS - hours[d]) for d in last7)), "nights_last7": len(last7),
            "nights_equivalent_lost": _r(max(0, -bal) / TARGET_HOURS, 1), "balance": cum,
            "note": "Only nights that were logged count. A night that was not logged is neither short nor long."}

    # regularity
    swings = [abs(vals[i] - vals[i - 1]) for i in range(1, len(vals)) if (nights_d[i] - nights_d[i - 1]).days == 1]
    mid = start + (end - start) / 2
    early = [h for d, h in zip(nights_d, vals) if datetime(d.year, d.month, d.day, tzinfo=UTC) < mid]
    late = [h for d, h in zip(nights_d, vals) if datetime(d.year, d.month, d.day, tzinfo=UTC) >= mid]
    halves = None
    if len(early) >= HALF_MIN and len(late) >= HALF_MIN:
        e_sd, l_sd = pstdev(early), pstdev(late)
        halves = {"first_sd": _r(e_sd), "second_sd": _r(l_sd), "first_mean": _r(mean(early)), "second_mean": _r(mean(late)),
                  "direction": "more_erratic" if l_sd - e_sd >= 0.25 else "steadier" if e_sd - l_sd >= 0.25 else "similar"}
    after_short, after_ok = [], []
    for i in range(len(vals) - 1):
        if (nights_d[i + 1] - nights_d[i]).days != 1:
            continue
        (after_short if short_flags[i] else after_ok).append(vals[i + 1])
    rebound = None
    if len(after_short) >= MIN_PER_GROUP and len(after_ok) >= MIN_PER_GROUP:
        rebound = {"after_short_mean": _r(mean(after_short)), "after_ok_mean": _r(mean(after_ok)), "n_after_short": len(after_short), "n_after_ok": len(after_ok),
                   "catches_up": bool(mean(after_short) - mean(after_ok) >= REBOUND_GAIN),
                   "rule": f"Counts as catching up when the night after a short night is at least {REBOUND_GAIN:g} h longer than the night after a night that met the guideline."}
    regularity = {"sd_hours": summary["sd"], "swing_hours": _r(mean(swings)) if swings else None, "usual": usual, "halves": halves, "rebound": rebound}

    # hours against the rating
    pairs = [(hours[d], mean(quality[d]), d) for d in nights_d if quality.get(d)]
    rating = None
    if len(pairs) >= MIN_FOR_RATING:
        res = _spearman([p[0] for p in pairs], [p[1] for p in pairs])
        enough = lambda p: p[0] >= TARGET_HOURS  # noqa: E731
        good = lambda p: p[1] >= QUALITY_OK  # noqa: E731
        rating = {"n": len(pairs), "quality_ok": QUALITY_OK, "target_hours": TARGET_HOURS,
                  "r": _r(res[0]) if res else None, "p": _r(res[1], 3) if res else None, "strength": wb._strength(res[0]) if res else None,
                  "points": [{"date": p[2].isoformat(), "hours": _r(p[0]), "rating": _r(p[1], 1)} for p in pairs],
                  "quadrants": {"enough_and_rested": sum(enough(p) and good(p) for p in pairs), "enough_not_rested": sum(enough(p) and not good(p) for p in pairs),
                                "short_but_rested": sum((not enough(p)) and good(p) for p in pairs), "short_and_not_rested": sum((not enough(p)) and not good(p) for p in pairs)}}

    # days after a short night against days after a night that met the guideline (same-day readings)
    def daily(day, field, source):
        v = source[day].get(field)
        return mean(v) if v else None
    cost_rows = []
    short_days = [d for d, b in zip(nights_d, bands) if b != "ok"]
    ok_days = [d for d, b in zip(nights_d, bands) if b == "ok"]
    for src, defs in ((per, OBS_METRICS), (cog, COG_METRICS)):
        for field, label, unit, hib in defs:
            a = [x for x in (daily(d, field, src) for d in short_days if d in src) if x is not None]
            b = [x for x in (daily(d, field, src) for d in ok_days if d in src) if x is not None]
            if len(a) < MIN_PER_GROUP or len(b) < MIN_PER_GROUP:
                continue
            pooled = math.sqrt((np.var(a) * len(a) + np.var(b) * len(b)) / (len(a) + len(b)))
            diff = mean(a) - mean(b)
            effect = diff / pooled if pooled > 0 else 0.0
            worse = None if hib is None else bool((diff < 0) == hib and diff != 0)
            cost_rows.append({"key": field, "label": label, "unit": unit, "higher_is_better": hib, "after_short": _r(mean(a), 1), "after_ok": _r(mean(b), 1),
                              "difference": _r(diff, 1), "effect": _r(effect), "noticeable": bool(abs(effect) >= EFFECT_NOTICEABLE),
                              "worse_after_short": worse, "n_short": len(a), "n_ok": len(b)})
    cost = {"rows": cost_rows, "short_days": len(short_days), "ok_days": len(ok_days),
            "rule": f"Days after a night under {TARGET_HOURS:g} h against days after a night of {TARGET_HOURS:g} h or more, using what was recorded on the same day. "
                    f"Needs {MIN_PER_GROUP}+ days in each group. 'Noticeable' = a difference of half a spread or more. A pattern in this astronaut's own history, not proof of cause."} if cost_rows else None

    return {
        "available": True,
        "window": {"days": days, "start": start.isoformat(), "end": end.isoformat(), "days_since_latest": max(0, (datetime.now(UTC) - end).days)},
        "rules": {"target_hours": TARGET_HOURS, "bands": [{"band": k, "text": v} for k, v in BAND_TEXT.items()],
                  "source": _SLEEP_RULE.source, "min_for_usual": MIN_FOR_USUAL, "min_nights": MIN_NIGHTS, "min_for_rating": MIN_FOR_RATING},
        "nightly": nightly, "summary": summary, "debt": debt, "regularity": regularity, "rating": rating, "cost": cost,
        "reading": _log_reading(summary, debt, regularity, rating, cost),
    }


def _log_reading(s, debt, reg, rating, cost):
    cards = []
    ln = s["last_night"]
    txt = f"Last night: {_hm(ln['hours'])}, {BAND_TEXT[ln['band']]} (guideline {TARGET_HOURS:g} h or more)."
    if ln["usual"]:
        u = ln["usual"]
        txt += f" Your usual is {u['mean']:g} h (range {u['low']:g} to {u['high']:g}); last night was {u['latest_vs_usual']} it ({u['latest_difference']:+g} h)."
    cards.append({"tone": "ok" if ln["band"] == "ok" else "bad" if ln["band"] in ("severe", "inadequate") else "warn", "title": "Last night", "text": txt, "evidence": "guideline"})
    if debt["net_hours"] is not None and debt["net_hours"] < -1:
        cards.append({"tone": "warn" if debt["net_hours"] > -7 else "bad", "title": "Sleep debt is building",
                      "text": f"Over {s['nights']} logged nights you are {abs(debt['net_hours']):g} h short of {TARGET_HOURS:g} h a night, about {debt['nights_equivalent_lost']:g} full nights of sleep. "
                              f"The last {debt['nights_last7']} nights alone fell {debt['short_hours_last7']:g} h short.", "evidence": "guideline"})
    elif debt["net_hours"] is not None:
        cards.append({"tone": "ok", "title": "No sleep debt", "text": f"Across {s['nights']} logged nights you are {debt['net_hours']:+g} h against {TARGET_HOURS:g} h a night.", "evidence": "guideline"})
    if s["current_short_run"] >= 2 or s["longest_short_run"] >= 3:
        cards.append({"tone": "bad" if s["current_short_run"] >= 3 else "warn", "title": "Short nights in a row",
                      "text": f"{s['current_short_run']} short night{'s' if s['current_short_run'] != 1 else ''} in a row right now; the longest run in this window was {s['longest_short_run']}. "
                              f"The longest stretch meeting the guideline was {s['longest_ok_run']}.", "evidence": "guideline"})
    h = reg.get("halves")
    if h and h["direction"] == "more_erratic":
        cards.append({"tone": "warn", "title": "Sleep is getting less regular",
                      "text": f"Night-to-night spread rose from {h['first_sd']:g} h in the first half of the window to {h['second_sd']:g} h in the second.", "evidence": "proxy"})
    elif h and h["direction"] == "steadier":
        cards.append({"tone": "ok", "title": "Sleep is settling", "text": f"Night-to-night spread fell from {h['first_sd']:g} h to {h['second_sd']:g} h.", "evidence": "proxy"})
    rb = reg.get("rebound")
    if rb:
        cards.append({"tone": "ok" if rb["catches_up"] else "warn", "title": "Catch-up after a short night",
                      "text": (f"After a short night you slept {rb['after_short_mean']:g} h the next night, against {rb['after_ok_mean']:g} h after a good one. "
                               + ("Short nights are being recovered." if rb["catches_up"] else "Short nights are not being made up, so the debt carries forward.")), "evidence": "proxy"})
    if rating and rating["quadrants"]["enough_not_rested"] >= 2:
        cards.append({"tone": "warn", "title": "Long enough but not restful",
                      "text": f"{rating['quadrants']['enough_not_rested']} of {rating['n']} nights met {TARGET_HOURS:g} h but were rated under {rating['quality_ok']}/10. Quality, not length, may be the problem on those nights.", "evidence": "proxy"})
    if cost:
        bad = [r for r in cost["rows"] if r["noticeable"] and r["worse_after_short"]]
        if bad:
            cards.append({"tone": "warn", "title": "Short nights show up the next day",
                          "text": "After a short night: " + "; ".join(f"{r['label'].lower()} {r['after_short']:g} against {r['after_ok']:g} {r['unit']}".strip() for r in bad[:3]) + ".", "evidence": "proxy"})
    return cards


# ---------------------------------------------------------------------------------------------
# B. one MMASH volunteer's measured night against the cohort
# ---------------------------------------------------------------------------------------------
LAB_VARS = [  # (key, label, unit, higher_is_better, note, reference or None)
    ("total_sleep_hours", "Time asleep", "h", True, "measured night", {"value": TARGET_HOURS, "text": f"under {TARGET_HOURS:g} h is below the guideline", "past": "lt"}),
    ("sleep_efficiency_percent", "Sleep efficiency", "%", True, "share of time in bed asleep", {"value": EFFICIENCY_LINE, "text": f"under {EFFICIENCY_LINE}% is low efficiency", "past": "lt"}),
    ("total_waso_minutes", "Awake after falling asleep", "min", False, "WASO", {"value": WASO_LINE, "text": f"over {WASO_LINE} min is disturbed sleep", "past": "gt"}),
    ("total_awakenings", "Night awakenings", "", False, "count", None),
    ("awakenings_per_hour", "Awakenings per hour asleep", "/h", False, "fragmentation", None),
    ("mean_wake_bout_min", "Average wake bout", "min", False, "WASO / awakenings", None),
]
SPLIT_OUTCOMES = [("sleep_efficiency_percent", "Sleep efficiency", True), ("total_sleep_hours", "Time asleep", True), ("total_awakenings", "Night awakenings", False)]
SPLIT_PARTNERS = [  # (key, label, unit)
    ("hrv_mean_rr_rmssd_ms", "HRV, beat to beat (RMSSD)", "ms"), ("hrv_mean_rr_sdnn_ms", "HRV, overall (SDNN)", "ms"),
    ("original_mean_heart_rate_bpm", "Mean heart rate", "bpm"), ("steps_per_day", "Steps per day", "steps"), ("mean_vector_magnitude", "Movement magnitude", ""),
    ("Daily_stress", "Daily stress", ""), ("STAI1", "Anxiety, state (STAI-1)", ""), ("STAI2", "Anxiety, trait (STAI-2)", ""),
    ("panas_neg_10", "Negative affect", ""), ("panas_pos_10", "Positive affect", ""),
]
# Sleep science expectation for the model's sleep inputs (+1: higher value should RAISE the chance of poor sleep). Others are ambiguous and left out.
EXPECTED_PUSH = {"total_sleep_minutes": -1, "total_waso_minutes": +1, "total_awakenings": +1, "sleep_efficiency_percent": -1, "Daily_stress": +1, "STAI1": +1, "STAI2": +1}
FEATURE_LABEL = {"total_sleep_minutes": "Time asleep", "total_waso_minutes": "Awake after falling asleep", "total_awakenings": "Night awakenings",
                 "sleep_efficiency_percent": "Sleep efficiency", "total_steps": "Total steps", "original_mean_heart_rate_bpm": "Mean heart rate",
                 "mean_vector_magnitude": "Movement magnitude", "Daily_stress": "Daily stress", "STAI1": "Anxiety, state (STAI-1)",
                 "STAI2": "Anxiety, trait (STAI-2)", "hrv_mean_rr_rmssd_ms": "HRV, beat to beat (RMSSD)"}


def _lab_frame():
    f = wb._frame()
    f["total_sleep_hours"] = pd.to_numeric(f["total_sleep_minutes"], errors="coerce") / 60
    asleep_h = f["total_sleep_hours"]
    f["awakenings_per_hour"] = np.where(asleep_h > 0, pd.to_numeric(f["total_awakenings"], errors="coerce") / asleep_h, np.nan)
    f["mean_wake_bout_min"] = np.where(pd.to_numeric(f["total_awakenings"], errors="coerce") > 0,
                                       pd.to_numeric(f["total_waso_minutes"], errors="coerce") / pd.to_numeric(f["total_awakenings"], errors="coerce"), np.nan)
    return f


def _lab_variables(frame, user):
    me = frame[frame["participant_id"] == user].iloc[0]
    out = []
    for key, label, unit, hib, note, ref in LAB_VARS:
        if key not in frame.columns:
            continue
        col = pd.to_numeric(frame[key], errors="coerce")
        valid = frame.assign(_v=col).dropna(subset=["_v"])
        mine = _num(me[key])
        if valid.empty or mine is None:
            continue
        others = valid.loc[valid["participant_id"] != user, "_v"].tolist()
        share = _share_below(others, mine)
        verdict = None if share is None else "higher" if share >= HIGH_SHARE else "lower" if share <= LOW_SHARE else "typical"
        past = None if ref is None else bool(mine < ref["value"] if ref["past"] == "lt" else mine > ref["value"])
        out.append({"key": key, "label": label, "unit": unit, "note": note, "higher_is_better": hib, "value": mine, "n": int(len(valid)),
                    "middle": float(valid["_v"].median()), "q25": float(valid["_v"].quantile(0.25)), "q75": float(valid["_v"].quantile(0.75)),
                    "min": float(valid["_v"].min()), "max": float(valid["_v"].max()), "higher_than": share, "verdict": verdict,
                    "rank_from_top": int((valid["_v"] > mine).sum()) + 1,
                    "reference": None if ref is None else {"value": ref["value"], "text": ref["text"]}, "past_reference": past})
    return out


def _profile(variables):
    by = {v["key"]: v for v in variables}
    flags = []
    if by.get("total_sleep_hours", {}).get("past_reference"):
        flags.append({"key": "short", "label": "Short", "text": f"{_hm(by['total_sleep_hours']['value'])} asleep, under {TARGET_HOURS:g} h"})
    if by.get("sleep_efficiency_percent", {}).get("past_reference"):
        flags.append({"key": "inefficient", "label": "Low efficiency", "text": f"{by['sleep_efficiency_percent']['value']:.0f}% of time in bed asleep, under {EFFICIENCY_LINE}%"})
    if by.get("total_waso_minutes", {}).get("past_reference"):
        flags.append({"key": "waso", "label": "Long wake time", "text": f"{by['total_waso_minutes']['value']:.0f} min awake after falling asleep, over {WASO_LINE} min"})
    f = by.get("awakenings_per_hour")
    if f and f["verdict"] == "higher":
        more = "more than every other volunteer" if f["higher_than"] >= 0.995 else f"more than {f['higher_than'] * 100:.0f}% of the other volunteers"
        flags.append({"key": "fragmented", "label": "Fragmented", "text": f"{f['value']:.1f} awakenings per hour asleep, {more}"})
    return {"flags": flags, "clear": not flags,
            "summary": ("No flag on this night: duration, efficiency and wake time are all inside the lines." if not flags
                        else f"{len(flags)} of 4 checks flag this night: " + ", ".join(x["label"].lower() for x in flags) + ".")}


def _perception(frame, user, variables):
    """What the volunteer's own PSQI says against what the sensor measured."""
    by = {v["key"]: v for v in variables}
    row = frame[frame["participant_id"] == user]
    psqi = _num(row["Pittsburgh"].iloc[0]) if "Pittsburgh" in row.columns and len(row) else None
    if psqi is None:
        return None
    rows = [{"source": "Own questionnaire (PSQI)", "detail": f"score {psqi:g}; over {wb.PSQI_POOR} = poor sleeper", "poor": bool(psqi > wb.PSQI_POOR)}]
    for key, src in (("sleep_efficiency_percent", "Measured efficiency"), ("total_sleep_hours", "Measured duration"), ("total_waso_minutes", "Measured wake time")):
        v = by.get(key)
        if v and v["past_reference"] is not None:
            rows.append({"source": src, "detail": f"{v['value']:.{0 if key != 'total_sleep_hours' else 1}f} {v['unit']}; {v['reference']['text']}".strip(), "poor": bool(v["past_reference"])})
    measured = [r["poor"] for r in rows[1:]]
    if not measured:
        return None
    poor_measured = sum(measured)
    verdict = ("agree_poor" if rows[0]["poor"] and poor_measured else "agree_good" if not rows[0]["poor"] and not poor_measured
               else "feels_worse" if rows[0]["poor"] else "feels_better")
    text = {"agree_poor": "The volunteer rates their sleep as poor and the sensor agrees.",
            "agree_good": "The volunteer rates their sleep as fine and the sensor agrees.",
            "feels_worse": "The volunteer rates their sleep as poor, but the sensor measured a night inside the lines. Perceived sleep can lag or differ from measured sleep.",
            "feels_better": "The volunteer rates their sleep as fine, but the sensor flags the night. People often under-notice short or broken sleep."}[verdict]
    return {"rows": rows, "verdict": verdict, "text": text, "measured_poor": poor_measured, "measured_checks": len(measured)}


def _split(frame, user):
    """Better-sleeping half of the cohort against the other half."""
    out = []
    for okey, olabel, hib in SPLIT_OUTCOMES:
        if okey not in frame.columns:
            continue
        col = pd.to_numeric(frame[okey], errors="coerce")
        valid = frame.assign(_o=col).dropna(subset=["_o"])
        if len(valid) < 2 * MIN_SPLIT_N:
            continue
        cut = valid["_o"].median()
        better = valid[valid["_o"] > cut] if hib else valid[valid["_o"] < cut]
        worse = valid[valid["_o"] <= cut] if hib else valid[valid["_o"] >= cut]
        if len(better) < MIN_SPLIT_N or len(worse) < MIN_SPLIT_N:
            continue
        mine = valid[valid["participant_id"] == user]
        mine_group = None if mine.empty else ("better" if mine["participant_id"].iloc[0] in set(better["participant_id"]) else "worse")
        rows = []
        for pkey, plabel, punit in SPLIT_PARTNERS:
            if pkey not in frame.columns:
                continue
            pv = pd.to_numeric(valid[pkey], errors="coerce")
            b, w = pv[better.index].dropna(), pv[worse.index].dropna()
            if len(b) < MIN_SPLIT_N or len(w) < MIN_SPLIT_N:
                continue
            res = wb._spearman(valid["_o"], pv)
            rows.append({"key": pkey, "label": plabel, "unit": punit, "better_mean": float(b.mean()), "worse_mean": float(w.mean()),
                         "r": None if res is None else res[0], "p": None if res is None else res[1], "n": None if res is None else res[2],
                         "strength": None if res is None else wb._strength(res[0]),
                         "meaningful": bool(res is not None and abs(res[0]) >= wb.MEANINGFUL_R and res[1] < wb.ALPHA)})
        if rows:
            rows.sort(key=lambda x: abs(x["r"] or 0), reverse=True)
            out.append({"outcome": okey, "label": olabel, "higher_is_better": hib, "cut": float(cut), "n_better": int(len(better)), "n_worse": int(len(worse)),
                        "selected_group": mine_group, "rows": rows})
    return out or None


def _drivers(user):
    """Why the saved poor-sleep model said what it said: each input's push in log-odds (coefficient x standardised value)."""
    row = data_store.mmash_row(user)
    if row is None:
        return None
    try:
        model = predict.require_model("sleep_poor_logreg")
        cols = predict._features(model)
        imputer, scaler, lr = model.named_steps["simpleimputer"], model.named_steps["standardscaler"], model.named_steps["logisticregression"]
        x = imputer.transform(row[cols])
        z = scaler.transform(x)[0]
        coef = lr.coef_[0]
        proba = float(model.predict_proba(row[cols])[0, 1])
    except (FileNotFoundError, KeyError, ValueError, AttributeError):
        return None
    raw = row[cols].iloc[0]
    items, total_abs = [], float(np.sum(np.abs(coef * z))) or 1.0
    for i, c in enumerate(cols):
        push = float(coef[i] * z[i])
        exp = EXPECTED_PUSH.get(c)
        items.append({"key": c, "label": FEATURE_LABEL.get(c, wb._pretty(c)), "value": _num(raw[c]), "imputed": bool(pd.isna(raw[c])), "training_mean": float(scaler.mean_[i]),
                      "z": float(z[i]), "push": push, "share_of_push": abs(push) / total_abs, "raises_poor_sleep_chance": bool(push > 0),
                      "as_expected": None if exp is None or abs(z[i]) < 0.25 else bool((push > 0) == (exp * z[i] > 0))})
    items.sort(key=lambda d: abs(d["push"]), reverse=True)
    judged = [d for d in items if d["as_expected"] is not None]
    pm = (ml_service._read_json("metrics.json") or {}).get("sleep_poor_logreg") or {}
    base = 1 / (1 + math.exp(-float(lr.intercept_[0])))
    return {"probability": proba, "average_input_probability": base, "flagged": bool(proba > 0.5), "drivers": items[:8],
            "against_expectation": sum(not d["as_expected"] for d in judged), "judged": len(judged), "roc_auc": pm.get("roc_auc"), "warning": pm.get("warning"),
            "note": "Each bar is how far this volunteer's input is from the training average, times the model's weight for it (log-odds; positive = raises the chance of poor sleep). "
                    "The volunteer was one of the 21 the model was trained on."}


def _lab_reading(variables, profile, perception, split, drivers, n):
    cards = []
    cards.append({"tone": "ok" if profile["clear"] else "warn", "title": "This night against the lines", "text": profile["summary"] + " " + " ".join(f"{f['text']}." for f in profile["flags"]), "evidence": "convention"})
    by = {v["key"]: v for v in variables}
    for key in ("sleep_efficiency_percent", "total_sleep_hours", "awakenings_per_hour"):
        v = by.get(key)
        if v and v["verdict"] in ("higher", "lower"):
            good = (v["verdict"] == "higher") == bool(v["higher_is_better"])
            cards.append({"tone": "ok" if good else "warn", "title": f"{v['label']} is {v['verdict']} than most", "evidence": "proxy",
                          "text": f"{v['value']:.1f} {v['unit']}".strip() + f" against a cohort middle of {v['middle']:.1f}; " + ("above every other volunteer." if v["higher_than"] >= 0.995 else "below every other volunteer." if v["higher_than"] <= 0.005 else f"above {v['higher_than'] * 100:.0f}% of the other {v['n'] - 1} volunteers.")})
    if perception and perception["verdict"] in ("feels_worse", "feels_better"):
        cards.append({"tone": "warn", "title": "Feeling and measurement differ", "text": perception["text"], "evidence": "proxy"})
    if split:
        top = next((s for s in split if s["outcome"] == "sleep_efficiency_percent"), split[0])
        sig = [r for r in top["rows"] if r["meaningful"]]
        if sig:
            r = sig[0]
            cards.append({"tone": "mute", "title": f"What goes with {top['label'].lower()}", "evidence": "proxy",
                          "text": f"Among these {n} volunteers, {r['label'].lower()} is the clearest companion (Spearman {r['r']:+.2f}, {wb._p_text(r['p'])}, n {r['n']}). The better-sleeping half averages {r['better_mean']:.1f} against {r['worse_mean']:.1f} for the rest {r['unit']}".strip() + ". Exploratory, not a cause."})
        else:
            cards.append({"tone": "mute", "title": f"Nothing clearly goes with {top['label'].lower()}", "evidence": "proxy",
                          "text": f"No measure in the other files moves with {top['label'].lower()} strongly enough to read anything into at n = {n}."})
    if drivers:
        txt = (f"The saved model gave {drivers['probability'] * 100:.0f}% for poor sleep. "
               + (f"{drivers['against_expectation']} of {drivers['judged']} of its sleep and stress inputs push the opposite way from sleep science, " if drivers["judged"] else "")
               + f"and its ROC AUC is {drivers['roc_auc']:.2f} (0.50 = a coin flip), so treat the drivers as a look inside a weak model, not as advice.") if drivers.get("roc_auc") is not None else \
            f"The saved model gave {drivers['probability'] * 100:.0f}% for poor sleep. It is a weak model."
        cards.append({"tone": "warn" if drivers["flagged"] else "mute", "title": "Why the model said what it said", "text": txt, "evidence": "weak"})
    return cards


def _lab_block(req: SleepInsightRequest):
    """(mmash_user, lab block). The volunteer is resolved exactly as the other insight pages do."""
    chosen, _, _ = ml_service._merge_defaults(DayRequest(scenario_id=req.scenario_id, subject_id=req.subject_id, mmash_user=req.mmash_user))
    try:
        user = data_store.resolve_mmash_user(chosen.get("mmash_user"))
    except (data_store.DataNotFound, FileNotFoundError) as exc:
        return None, {"available": False, "reason": str(exc)}
    if not user:
        return None, None
    try:
        frame = _lab_frame()
    except data_store.DataNotFound as exc:
        return user, {"available": False, "reason": str(exc)}
    if user not in set(frame["participant_id"]):
        return user, {"available": False, "reason": f"{user} is not in the sleep summary file."}
    n = int(frame["participant_id"].nunique())
    variables = _lab_variables(frame, user)
    if not variables:
        return user, {"available": False, "reason": "The sleep summary has no usable values for this volunteer."}
    profile = _profile(variables)
    perception = _perception(frame, user, variables)
    split = _split(frame, user)
    drivers = _drivers(user)
    return user, {"available": True, "participant": user, "cohort_size": n, "variables": variables, "profile": profile, "perception": perception,
                  "split": split, "drivers": drivers, "reading": _lab_reading(variables, profile, perception, split, drivers, n),
                  "population_note": "One recorded night each from 21 healthy young men on Earth (MMASH), not astronauts. Correlations are exploratory."}


# ---------------------------------------------------------------------------------------------
def get_sleep_insight(db: Session, req: SleepInsightRequest) -> dict:
    log = None
    try:
        if astronaut_repo.get(db, req.astronaut_id) is not None:
            log = _log_block(db, req.astronaut_id, req.days)
    except AppError:
        log = None
    user, lab = _lab_block(req)
    return _clean({"selection": {"mmash_user": user, "astronaut_id": req.astronaut_id}, "log": log, "lab": lab,
                   "disclaimer": "Decision-support only. Not a medical diagnosis."})
