"""Deep-dive numbers for the Trends & Analytics page (POST /api/v1/ml/analytics-insight).

The two panels that were already on the page (blood across the mission for one astronaut, AUC of each model) stay as
they were. This module adds what a "trends" page should show and the others do not: all of one astronaut's logged data
in one place, how the measures move together, how risk and alerts evolved, the blood signal across the whole crew, and
how far each saved model can be trusted. Same rule as the other insight services: nothing is typed in and nothing is
guessed. The frontend only says WHICH astronaut and how many days; everything else is read here.

  coverage     how much of the window has data, per measure (days logged, longest gap)
  metrics      one block per measure the astronaut logged (vitals, sleep, wellbeing, cognitive, exercise): daily series with
               a 7-day mean and a fitted trend, slope with p-value, last 7 days against the 7 before, spread, and the share
               of days outside the published reference range
  relations    Spearman correlation between measures on the same day, and one day later, with n and p for every pair, and a
               note on how many pairs were tested (some will look "significant" by chance)
  risk         risk assessments over time by category (level mix per week, score trend) and the alert queue
  blood        the two post-flight blood models run on every timepoint of every crew member, and which blood values moved the
               same way in the whole crew after landing and how much of that had recovered by the last sample
  models       scorecard of every saved model: sample size, validation, headline metric with a 95% interval where it can be
               computed, whether it beats the naive baseline, and what that means

A block that cannot be computed is left out of the answer, never filled with a default. References are published values and
carry their source. Decision-support only; nothing here changes the Good / Warning / Critical level.
"""
import math
import re
from collections import Counter, defaultdict
from datetime import UTC, datetime, timedelta
from statistics import median

import numpy as np
import pandas as pd
from scipy import stats
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ml import data_store, predict
from app.models.exercise import ExerciseSession
from app.repositories import alert_repo, astronaut_repo, observation_repo, risk_repo, wellbeing_repo
from app.schemas.ml import AnalyticsInsightRequest
from app.schemas.observation import to_utc
from app.services import ml_service
from app.services import vitals_insight_service as vis
from app.services.vitals_insight_service import _clean

# ---- design choices (written here so the team can read and change them) ----------------------------------------------
MIN_DAYS_METRIC = 5          # days with a value before a measure gets its own block
MIN_PAIRS = 8                # overlapping days before two measures are compared
ALPHA = 0.05                 # p-value line for "clear trend" / "clear relation"
ROLL = 7                     # days in the rolling mean
NOTICEABLE_SD = 0.5          # last 7 days must differ from the 7 before by this many spreads to be called noticeable
TOP_RELATIONS = 8
TOP_ANALYTES = 12
CONSISTENT_MIN_PCT = 5.0     # mean % change after landing for a blood value to count as a crew-wide shift
LEVELS = ["low", "medium", "high", "critical"]
PRIORITIES = ["low", "medium", "high", "critical"]
FLAG_LINE = 0.5              # same flag line the Overview page uses for the blood models

SRC = {
    "aha_hr": "Normal resting adult heart rate is 60 to 100 bpm (American Heart Association).",
    "spo2": "A normal resting oxygen saturation is 95% or higher (common clinical convention).",
    "temp": "Normal adult body temperature is about 36.1 to 37.2 C.",
    "aha_bp_sys": "AHA: a normal systolic blood pressure is under 120 mmHg.",
    "aha_bp_dia": "AHA: a normal diastolic blood pressure is under 80 mmHg.",
    "aasm": "AASM/SRS consensus (2015): 7 or more hours of sleep a night for adults.",
}

# key, label, unit, source ("obs" column, "well" column, "cog" column, "ex" exercise), better direction, reference (low, high, text, source)
METRICS = [
    ("hr", "Heart rate", "bpm", "heart_rate_bpm", None, (60, 100, "60 to 100 bpm", SRC["aha_hr"])),
    ("spo2", "Blood oxygen (SpO2)", "%", "spo2_percent", "higher", (95, None, "95% or higher", SRC["spo2"])),
    ("temp", "Body temperature", "C", "body_temperature_c", None, (36.1, 37.2, "36.1 to 37.2 C", SRC["temp"])),
    ("sys", "Systolic blood pressure", "mmHg", "systolic_bp", "lower", (None, 120, "under 120 mmHg", SRC["aha_bp_sys"])),
    ("dia", "Diastolic blood pressure", "mmHg", "diastolic_bp", "lower", (None, 80, "under 80 mmHg", SRC["aha_bp_dia"])),
    ("sleep", "Sleep", "h", "sleep_hours", "higher", (7, None, "7 h or more", SRC["aasm"])),
    ("fatigue", "Fatigue", "/10", "fatigue_level", "lower", None),
    ("stress", "Stress", "/10", "stress_level", "lower", None),
    ("mood", "Mood", "/10", "mood_score", "higher", None),
    ("reaction", "Reaction time", "ms", "reaction_time_ms", "lower", None),
    ("attention", "Attention score", "/100", "attention_score", "higher", None),
    ("exercise", "Exercise", "min/day", "exercise_min", "higher", None),
]
LABEL = {m[0]: m[1] for m in METRICS}


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------
def _r(x, nd=1):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    return round(v, nd) if math.isfinite(v) else None


def _day(dt):
    return to_utc(dt).date()


def _daily_frame(db: Session, astronaut_id: int, start, end) -> pd.DataFrame:
    """One row per calendar day (UTC), one column per measure, mean of everything logged that day."""
    rows = []
    obs, _ = observation_repo.list_for_astronaut(db, astronaut_id, 0, 20_000, start, end)
    for o in obs:
        rows.append({"day": _day(o.observed_at), "hr": o.heart_rate_bpm, "spo2": o.spo2_percent, "temp": o.body_temperature_c,
                     "sys": o.systolic_bp, "dia": o.diastolic_bp, "sleep": o.sleep_hours, "fatigue": o.fatigue_level,
                     "stress": o.stress_level, "mood": o.mood_score})
    wells = wellbeing_repo.in_window(db, astronaut_id, start, end)
    for w in wells:
        d = _day(w.assessed_at)
        rows.append({"day": d, "fatigue": w.fatigue, "stress": w.stress, "mood": w.mood})
        if w.cognitive is not None:
            rows.append({"day": d, "reaction": w.cognitive.reaction_time_ms, "attention": w.cognitive.attention_score})
    ex = db.scalars(select(ExerciseSession).where(ExerciseSession.astronaut_id == astronaut_id, ExerciseSession.performed_at >= start,
                                                  ExerciseSession.performed_at <= end)).all()
    per_ex = defaultdict(int)
    for e in ex:
        per_ex[_day(e.performed_at)] += e.minutes
    if not rows and not per_ex:
        return pd.DataFrame()
    df = pd.DataFrame(rows) if rows else pd.DataFrame(columns=["day"])
    df = df.groupby("day").mean(numeric_only=True)
    if per_ex:
        df = df.join(pd.Series(per_ex, name="exercise"), how="outer")
    df.index = pd.to_datetime(df.index)
    return df.sort_index()


def _longest_gap(days_with: list, first, last) -> int:
    have = set(days_with)
    gap = best = 0
    d = first
    while d <= last:
        gap = 0 if d in have else gap + 1
        best = max(best, gap)
        d += timedelta(days=1)
    return best


# ---------------------------------------------------------------------------------------------
# logged measures
# ---------------------------------------------------------------------------------------------
def _metric_block(key, label, unit, better, ref, s: pd.Series, window_end):
    s = s.dropna()
    n = len(s)
    if n < MIN_DAYS_METRIC:
        return None
    sd = float(s.std(ddof=1)) if n > 1 else 0.0
    x = (s.index - s.index[0]).days.to_numpy(dtype=float)
    lr = stats.linregress(x, s.to_numpy(dtype=float)) if len(set(x)) > 1 and sd > 0 else None
    roll = s.rolling(f"{ROLL}D", min_periods=3).mean()
    z = (s - s.mean()) / sd if sd > 0 else s * 0
    series = []
    for i, (d, v) in enumerate(s.items()):
        series.append({"date": d.date().isoformat(), "value": _r(v, 2), "roll": _r(roll.iloc[i], 2), "z": _r(z.iloc[i], 2),
                       "trend": _r(lr.intercept + lr.slope * x[i], 2) if lr else None})
    span = float(x[-1] - x[0]) if len(x) > 1 else 0.0
    direction, change_sd = "steady", None
    if lr and lr.pvalue < ALPHA and sd > 0:
        direction = "rising" if lr.slope > 0 else "falling"
    if lr and sd > 0:
        change_sd = lr.slope * span / sd
    last_day = s.index[-1]
    l7 = s[s.index > last_day - pd.Timedelta(days=ROLL)]
    p7 = s[(s.index <= last_day - pd.Timedelta(days=ROLL)) & (s.index > last_day - pd.Timedelta(days=2 * ROLL))]
    wow = None
    if len(l7) >= 3 and len(p7) >= 3:
        diff = float(l7.mean() - p7.mean())
        wow = {"last7": _r(l7.mean(), 2), "prev7": _r(p7.mean(), 2), "diff": _r(diff, 2), "pct": _r(diff / abs(p7.mean()) * 100, 1) if p7.mean() else None,
               "noticeable": bool(sd > 0 and abs(diff) >= NOTICEABLE_SD * sd), "n_last": len(l7), "n_prev": len(p7)}
    out = {"key": key, "label": label, "unit": unit, "better": better, "n_days": n, "series": series,
           "latest": {"date": last_day.date().isoformat(), "value": _r(s.iloc[-1], 2), "days_ago": max(0, (window_end.date() - last_day.date()).days)},
           "stats": {"mean": _r(s.mean(), 2), "sd": _r(sd, 2), "min": _r(s.min(), 2), "max": _r(s.max(), 2), "cv": _r(sd / abs(s.mean()), 3) if s.mean() else None,
                     "min_date": s.idxmin().date().isoformat(), "max_date": s.idxmax().date().isoformat()},
           "trend": {"direction": direction, "slope_per_week": _r(lr.slope * 7, 3) if lr else None, "p": _r(lr.pvalue, 4) if lr else None,
                     "r2": _r(lr.rvalue ** 2, 3) if lr else None, "change_over_window": _r(lr.slope * span, 2) if lr else None, "change_in_sd": _r(change_sd, 2)},
           "wow": wow, "reference": None}
    if ref:
        lo, hi, text, source = ref
        outside = (((s < lo) if lo is not None else False) | ((s > hi) if hi is not None else False))
        outside = pd.Series(outside, index=s.index) if not isinstance(outside, pd.Series) else outside
        out["reference"] = {"low": lo, "high": hi, "text": text, "source": source, "days_outside": int(outside.sum()), "share_outside": _r(outside.mean(), 3),
                            "latest_outside": bool(outside.iloc[-1])}
    return out


def _tone(m):
    """ok / warn / mute for the reading cards, from the reference line and the direction the measure should move."""
    t, ref = m["trend"], m["reference"]
    if ref and (ref["share_outside"] or 0) >= 0.5:
        return "warn"
    if t["direction"] != "steady" and m["better"]:
        worse = (t["direction"] == "falling") == (m["better"] == "higher")
        return "warn" if worse else "ok"
    return "mute"


def _metrics_reading(metrics):
    cards = []
    clear = [m for m in metrics if m["trend"]["direction"] != "steady"]
    for m in sorted(clear, key=lambda d: abs(d["trend"]["change_in_sd"] or 0), reverse=True)[:3]:
        t = m["trend"]
        cards.append({"tone": _tone(m), "title": f"{m['label']} is {t['direction']}", "evidence": "proxy",
                      "text": f"{m['label']} moved {t['change_over_window']:+.1f} {m['unit']} over the window ({t['change_in_sd']:+.1f} of its usual spread, p {t['p']:.3f}, {m['n_days']} days). "
                              f"Slope {t['slope_per_week']:+.2f} {m['unit']} a week."})
    if not clear:
        cards.append({"tone": "ok", "title": "No clear trend in any measure", "evidence": "proxy",
                      "text": f"None of the {len(metrics)} measures has a slope that is distinguishable from noise (p under {ALPHA}) in this window."})
    shifts = [m for m in metrics if m["wow"] and m["wow"]["noticeable"]]
    for m in sorted(shifts, key=lambda d: abs(d["wow"]["diff"] / (d["stats"]["sd"] or 1)), reverse=True)[:2]:
        w = m["wow"]
        cards.append({"tone": "warn" if _tone(m) == "warn" else "mute", "title": f"{m['label']}: the last 7 days stand out", "evidence": "proxy",
                      "text": f"{w['last7']:g} {m['unit']} against {w['prev7']:g} the 7 days before ({w['diff']:+.1f}), more than half of its usual day-to-day spread."})
    out = [m for m in metrics if m["reference"] and (m["reference"]["share_outside"] or 0) >= 0.25]
    for m in sorted(out, key=lambda d: d["reference"]["share_outside"], reverse=True)[:2]:
        r = m["reference"]
        cards.append({"tone": "warn", "title": f"{m['label']} is often outside its range", "evidence": "convention",
                      "text": f"{r['days_outside']} of {m['n_days']} days outside {r['text']} ({r['share_outside'] * 100:.0f}%). {r['source']}"})
    noisy = [m for m in metrics if m["stats"]["cv"] is not None and m["stats"]["cv"] > 0.35 and m["unit"] not in ("/10",)]
    if noisy:
        m = max(noisy, key=lambda d: d["stats"]["cv"])
        cards.append({"tone": "mute", "title": f"{m['label']} swings the most", "evidence": "proxy",
                      "text": f"Its spread is {m['stats']['cv'] * 100:.0f}% of its average, from {m['stats']['min']:g} to {m['stats']['max']:g} {m['unit']}."})
    return cards


def _coverage(df, metrics_all, first, last):
    span = (last - first).days + 1
    rows = []
    for key, label, unit, *_ in METRICS:
        if key not in df.columns:
            continue
        s = df[key].dropna()
        if s.empty:
            continue
        rows.append({"key": key, "label": label, "days": len(s), "share": _r(len(s) / span, 3), "longest_gap_days": _longest_gap([d.date() for d in s.index], first.date(), last.date()),
                     "last": s.index[-1].date().isoformat()})
    days_any = df.dropna(how="all").index
    return {"span_days": span, "days_with_data": len(days_any), "share": _r(len(days_any) / span, 3), "rows": rows,
            "longest_gap_days": _longest_gap([d.date() for d in days_any], first.date(), last.date()),
            "heat": [{"date": (first + timedelta(days=i)).date().isoformat(), "n": int(df.loc[(first + timedelta(days=i))].notna().sum()) if (first + timedelta(days=i)) in df.index else 0}
                     for i in range(span)]}


# ---------------------------------------------------------------------------------------------
# relations between measures
# ---------------------------------------------------------------------------------------------
def _strength(r):
    a = abs(r)
    return "very weak" if a < 0.2 else "weak" if a < 0.4 else "moderate" if a < 0.6 else "strong" if a < 0.8 else "very strong"


def _relations(df, keys):
    pairs, lag_pairs = [], []
    tested = 0
    for i, a in enumerate(keys):
        for b in keys[i + 1:]:
            both = df[[a, b]].dropna()
            if len(both) >= MIN_PAIRS and both[a].nunique() > 1 and both[b].nunique() > 1:
                rho, p = stats.spearmanr(both[a], both[b])
                if math.isfinite(rho):
                    tested += 1
                    pairs.append({"a": a, "b": b, "r": _r(rho, 3), "p": _r(p, 4), "n": len(both), "strength": _strength(rho), "clear": bool(p < ALPHA)})
    lag_tested = 0
    for a in keys:
        for b in keys:
            if a == b:
                continue
            shifted = pd.concat([df[a], df[b].shift(-1, freq="D")], axis=1, keys=[a, b]).dropna()
            if len(shifted) >= MIN_PAIRS and shifted[a].nunique() > 1 and shifted[b].nunique() > 1:
                rho, p = stats.spearmanr(shifted[a], shifted[b])
                if math.isfinite(rho):
                    lag_tested += 1
                    lag_pairs.append({"a": a, "b": b, "r": _r(rho, 3), "p": _r(p, 4), "n": len(shifted), "strength": _strength(rho), "clear": bool(p < ALPHA)})
    if not pairs:
        return None
    top = sorted([p for p in pairs if p["clear"]], key=lambda d: abs(d["r"]), reverse=True)[:TOP_RELATIONS]
    top_lag = sorted([p for p in lag_pairs if p["clear"]], key=lambda d: abs(d["r"]), reverse=True)[:5]
    return {"keys": keys, "labels": {k: LABEL[k] for k in keys}, "matrix": pairs, "top": top, "top_next_day": top_lag, "tested": tested, "lag_tested": lag_tested,
            "expected_by_chance": _r(tested * ALPHA, 1), "min_pairs": MIN_PAIRS,
            "note": f"Spearman rank correlation on days where both were logged (at least {MIN_PAIRS}). {tested} pairs were tested, so about {tested * ALPHA:.1f} would look clear by chance alone. "
                    "A relation is an association, not a cause."}


def _relations_reading(rel):
    cards = []
    if rel["top"]:
        t = rel["top"][0]
        direction = "rise together" if t["r"] > 0 else "move in opposite directions"
        cards.append({"tone": "mute", "title": "Strongest same-day relation", "evidence": "proxy",
                      "text": f"{LABEL[t['a']]} and {LABEL[t['b']]} {direction} (r {t['r']:+.2f}, {t['strength']}, n {t['n']}, p {t['p']:.3f})."})
    else:
        cards.append({"tone": "mute", "title": "No clear relation yet", "evidence": "proxy",
                      "text": f"{rel['tested']} pairs were compared and none is distinguishable from chance. More days of logging will sharpen this."})
    if rel["top_next_day"]:
        t = rel["top_next_day"][0]
        cards.append({"tone": "mute", "title": "Strongest next-day relation", "evidence": "proxy",
                      "text": f"{LABEL[t['a']]} today goes with {LABEL[t['b']]} tomorrow (r {t['r']:+.2f}, n {t['n']}, p {t['p']:.3f}). Order in time is not proof of cause."})
    chance = rel["expected_by_chance"]
    cards.append({"tone": "warn" if len(rel["top"]) <= chance else "ok", "title": "How many are real?", "evidence": "proxy",
                  "text": f"{len(rel['top'])} of {rel['tested']} pairs are clear; about {chance} would be by chance alone."})
    return cards


# ---------------------------------------------------------------------------------------------
# risk and alerts
# ---------------------------------------------------------------------------------------------
def _week(d):
    d = d.date() if hasattr(d, "date") else d
    return d - timedelta(days=d.weekday())


def _risk_block(db: Session, astronaut_id: int, start, end):
    items = risk_repo.in_window(db, astronaut_id, start, end)
    alerts, _ = alert_repo.list_for_astronaut(db, astronaut_id, 0, 1000)
    if not items and not alerts:
        return None
    out: dict = {}
    if items:
        weeks = defaultdict(lambda: Counter())
        by_cat = defaultdict(list)
        for a in items:
            w = _week(to_utc(a.assessed_at))
            weeks[w][a.level] += 1
            by_cat[a.category].append((to_utc(a.assessed_at), a.level, a.score))
        mix = [{"week": w.isoformat(), **{lv: c.get(lv, 0) for lv in LEVELS}, "total": sum(c.values())} for w, c in sorted(weeks.items())]
        cats = []
        for cat, pts in by_cat.items():
            pts.sort(key=lambda p: p[0])
            sc = [p[2] for p in pts]
            tr = None
            if len(pts) >= 4:
                xs = [(p[0] - pts[0][0]).total_seconds() / 86400 for p in pts]
                if len(set(xs)) > 1 and np.std(sc) > 0:
                    lr = stats.linregress(xs, sc)
                    tr = {"slope_per_week": _r(lr.slope * 7, 3), "p": _r(lr.pvalue, 4),
                          "direction": ("rising" if lr.slope > 0 else "falling") if lr.pvalue < ALPHA else "steady"}
            cats.append({"category": cat, "label": cat.replace("_", " "), "n": len(pts), "latest_level": pts[-1][1], "latest_score": _r(pts[-1][2], 2),
                         "latest_at": pts[-1][0].isoformat(), "worst_level": max((p[1] for p in pts), key=lambda l: LEVELS.index(l) if l in LEVELS else -1),
                         "share_high_or_critical": _r(sum(1 for p in pts if p[1] in ("high", "critical")) / len(pts), 3), "trend": tr,
                         "points": [{"at": p[0].isoformat(), "score": _r(p[2], 2), "level": p[1]} for p in pts]})
        cats.sort(key=lambda c: (LEVELS.index(c["latest_level"]) if c["latest_level"] in LEVELS else -1, c["n"]), reverse=True)
        total_levels = Counter(a.level for a in items)
        out["assessments"] = {"total": len(items), "levels": {lv: total_levels.get(lv, 0) for lv in LEVELS}, "weeks": mix, "categories": cats}
    if alerts:
        open_ = [a for a in alerts if a.status == "open"]
        acked = [a for a in alerts if a.acknowledged_at is not None]
        ttk = [(to_utc(a.acknowledged_at) - to_utc(a.created_at)).total_seconds() / 3600 for a in acked]
        now = datetime.now(UTC)
        pri = {p: {"open": sum(1 for a in open_ if a.priority == p), "acknowledged": sum(1 for a in alerts if a.priority == p and a.status != "open")} for p in PRIORITIES}
        wk = defaultdict(lambda: Counter())
        for a in alerts:
            wk[_week(to_utc(a.created_at))][a.priority] += 1
        out["alerts"] = {"total": len(alerts), "open": len(open_), "acknowledged": len(alerts) - len(open_), "by_priority": pri,
                         "median_hours_to_acknowledge": _r(median(ttk), 1) if ttk else None,
                         "oldest_open_hours": _r(max(((now - to_utc(a.created_at)).total_seconds() / 3600 for a in open_), default=0), 1) if open_ else None,
                         "weeks": [{"week": w.isoformat(), **{p: c.get(p, 0) for p in PRIORITIES}} for w, c in sorted(wk.items())]}
    out["reading"] = _risk_reading(out)
    return out


def _risk_reading(r):
    cards = []
    a = r.get("assessments")
    if a:
        top = [c for c in a["categories"] if c["latest_level"] in ("high", "critical")]
        if top:
            cards.append({"tone": "bad" if any(c["latest_level"] == "critical" for c in top) else "warn", "title": f"{len(top)} categor{'ies' if len(top) != 1 else 'y'} at high or critical now", "evidence": "proxy",
                          "text": "; ".join(f"{c['label']} ({c['latest_level']}, score {c['latest_score']})" for c in top[:4]) + "."})
        else:
            cards.append({"tone": "ok", "title": "Nothing high or critical at the latest assessment", "evidence": "proxy",
                          "text": f"{len(a['categories'])} categories were assessed {a['total']} times in the window; the latest level in each is low or medium."})
        rising = [c for c in a["categories"] if c["trend"] and c["trend"]["direction"] == "rising"]
        if rising:
            c = rising[0]
            cards.append({"tone": "warn", "title": f"{c['label']} risk score is rising", "evidence": "proxy",
                          "text": f"Slope {c['trend']['slope_per_week']:+.3f} a week over {c['n']} assessments (p {c['trend']['p']:.3f})."})
    al = r.get("alerts")
    if al:
        if al["open"]:
            cards.append({"tone": "warn", "title": f"{al['open']} alert{'s' if al['open'] != 1 else ''} still open", "evidence": "proxy",
                          "text": f"Oldest open alert is {al['oldest_open_hours']:.0f} h old." + (f" Acknowledged alerts took a median of {al['median_hours_to_acknowledge']:.1f} h." if al["median_hours_to_acknowledge"] is not None else "")})
        else:
            cards.append({"tone": "ok", "title": "No open alerts", "evidence": "proxy", "text": f"All {al['total']} alerts have been acknowledged."})
    return cards


# ---------------------------------------------------------------------------------------------
# blood across the crew
# ---------------------------------------------------------------------------------------------
def _tp_days(tp: str):
    m = re.match(r"^([LR])([+-])?(\d+)$", tp.strip(), flags=re.I)
    if not m:
        return None
    n = int(m.group(3))
    return -n if m.group(1).upper() == "L" else n


def _phase(tp):
    d = _tp_days(tp)
    if d is None:
        return None
    return f"{abs(d)} days before launch" if d < 0 else f"{d} day{'s' if d != 1 else ''} after landing"


def _blood_block():
    try:
        crew = data_store.blood_astronauts()
    except Exception:  # file not in the data folder
        return None
    if not crew:
        return None
    grid, summaries = [], []
    for astro in crew:
        tps = data_store.blood_timepoints(astro)
        pts = []
        for tp in tps:
            insp, osd = data_store.blood_rows(astro, tp)
            a = b = None
            try:
                a = predict.predict_blood_insp4(insp) if insp is not None else None
                b = predict.predict_blood_osd571(osd) if osd is not None else None
            except FileNotFoundError:
                pass
            pts.append({"tp": tp, "days": _tp_days(tp), "cbc": _r(a, 4), "metabolomics": _r(b, 4)})
        grid.append({"astronaut": astro, "points": pts})
        both = [(p, max(v for v in (p["cbc"], p["metabolomics"]) if v is not None)) for p in pts if p["cbc"] is not None or p["metabolomics"] is not None]
        if both:
            peak_p, peak_v = max(both, key=lambda t: t[1])
            post = [t for t in both if (t[0]["days"] or 0) > 0]
            pre = [t for t in both if (t[0]["days"] or 0) < 0]
            last_p, last_v = post[-1] if post else (None, None)
            summaries.append({"astronaut": astro, "peak_tp": peak_p["tp"], "peak": _r(peak_v, 3), "peak_over_line": bool(peak_v > FLAG_LINE),
                              "pre_mean": _r(np.mean([v for _, v in pre]), 3) if pre else None, "last_tp": last_p["tp"] if last_p else None, "last": _r(last_v, 3),
                              "last_under_line": bool(last_v <= FLAG_LINE) if last_v is not None else None})
    timepoints = sorted({p["tp"] for g in grid for p in g["points"]}, key=lambda t: (_tp_days(t) if _tp_days(t) is not None else 0))
    crew_mean = []
    for tp in timepoints:
        vals_a = [p["cbc"] for g in grid for p in g["points"] if p["tp"] == tp and p["cbc"] is not None]
        vals_b = [p["metabolomics"] for g in grid for p in g["points"] if p["tp"] == tp and p["metabolomics"] is not None]
        crew_mean.append({"tp": tp, "days": _tp_days(tp), "phase": _phase(tp), "cbc": _r(np.mean(vals_a), 4) if vals_a else None, "metabolomics": _r(np.mean(vals_b), 4) if vals_b else None,
                          "n_cbc": len(vals_a), "n_met": len(vals_b)})
    analytes = _analytes(crew)
    out = {"flag_line": FLAG_LINE, "astronauts": grid, "timepoints": [{"tp": t, "phase": _phase(t), "days": _tp_days(t)} for t in timepoints], "summaries": summaries,
           "crew_mean": crew_mean, "analytes": analytes}
    out["reading"] = _blood_reading(out)
    return out


def _analytes(crew):
    """Blood values that moved the same way in every astronaut after landing, and how much of that was gone at the last sample."""
    try:
        data = data_store._read("insp4")
        model = predict.require_model("insp4_postflight_logreg")
    except (data_store.DataNotFound, FileNotFoundError):
        return None
    cols = [c for c in (predict._features(model) or []) if c in data.columns]
    per: dict = {}
    first_post, last_post = {}, {}
    for astro in crew:
        mine = data[data.astronaut == astro]
        tps = sorted(mine.timepoint.dropna().unique().tolist(), key=vis._tp_order)
        pre = mine[mine.timepoint.isin([t for t in tps if not vis._is_post(t)])]
        post = [t for t in tps if vis._is_post(t)]
        if pre.empty or not post:
            continue
        first_post[astro], last_post[astro] = post[0], post[-1]
        for c in cols:
            base = vis._num(pd.to_numeric(pre[c], errors="coerce").mean())
            if base is None or base <= 0:
                continue
            for tp, store in ((post[0], "r1"), (post[-1], "last")):
                v = vis._num(mine[mine.timepoint == tp].iloc[0][c])
                pct = vis._pct(v, base)
                if pct is not None:
                    per.setdefault(c, {}).setdefault(astro, {})[store] = pct
    rows = []
    for c, by in per.items():
        r1 = [v["r1"] for v in by.values() if "r1" in v]
        last = [v["last"] for v in by.values() if "last" in v]
        if len(r1) < 3:
            continue
        up, down = sum(1 for v in r1 if v > 0), sum(1 for v in r1 if v < 0)
        mean_r1 = float(np.mean(r1))
        consistent = (up == len(r1) or down == len(r1)) and abs(mean_r1) >= CONSISTENT_MIN_PCT
        if not consistent:
            continue
        mean_last = float(np.mean(last)) if last else None
        rec = None
        if mean_last is not None:
            rec = max(0.0, min(1.0, 1 - mean_last / mean_r1)) if mean_last * mean_r1 > 0 else 1.0
        panel, label, unit = vis._describe_column(c)
        rows.append({"marker": label, "panel": panel, "unit": unit, "n": len(r1), "up": up, "down": down, "mean_pct": _r(mean_r1, 1), "min_pct": _r(min(r1), 1),
                     "max_pct": _r(max(r1), 1), "last_pct": _r(mean_last, 1), "recovered_share": _r(rec, 3)})
    rows = sorted(rows, key=lambda r: abs(r["mean_pct"]), reverse=True)[:TOP_ANALYTES]
    if not rows:
        return None
    return {"rows": rows, "first_post": sorted(set(first_post.values())), "last_post": sorted(set(last_post.values())), "crew": len(crew),
            "note": f"Percent change from each astronaut's own pre-flight mean at the first sample after landing. Only values that moved the same way in every astronaut with data and by "
                    f"{CONSISTENT_MIN_PCT:g}% or more on average are listed. 'Recovered' is how much of that shift is gone at the last sample."}


def _blood_reading(b):
    cards = []
    s = b["summaries"]
    if s:
        over = [x for x in s if x["peak_over_line"]]
        cards.append({"tone": "warn" if len(over) < len(s) else "mute", "title": f"{len(over)} of {len(s)} crew peak over the flag line", "evidence": "weak",
                      "text": "; ".join(f"{x['astronaut']} {x['peak'] * 100:.0f}% at {x['peak_tp']}" for x in s) + f". The flag line is {FLAG_LINE * 100:.0f}%. Both models are proof of concept (16 training rows)."})
        back = [x for x in s if x["last_under_line"]]
        cards.append({"tone": "ok" if len(back) == len(s) else "warn", "title": "Back under the line at the last sample", "evidence": "weak",
                      "text": f"{len(back)} of {len(s)} crew are under the line at their last post-flight sample ({', '.join(sorted({x['last_tp'] for x in s if x['last_tp']}))})."})
    a = b["analytes"]
    if a:
        r = a["rows"][0]
        cards.append({"tone": "mute", "title": f"{len(a['rows'])} blood values shifted the same way in the whole crew", "evidence": "weak",
                      "text": f"Largest: {r['marker']} {r['mean_pct']:+.0f}% on average ({r['min_pct']:+.0f}% to {r['max_pct']:+.0f}%)"
                              + (f", {r['recovered_share'] * 100:.0f}% recovered by the last sample." if r["recovered_share"] is not None else ".")})
    return cards


# ---------------------------------------------------------------------------------------------
# model scorecard
# ---------------------------------------------------------------------------------------------
def _hanley_ci(auc, n_pos, n_neg):
    """95% interval for an AUC (Hanley and McNeil 1982)."""
    if not (auc and n_pos and n_neg) or not (0.0 < auc < 1.0):
        return None
    q1, q2 = auc / (2 - auc), 2 * auc * auc / (1 + auc)
    var = (auc * (1 - auc) + (n_pos - 1) * (q1 - auc ** 2) + (n_neg - 1) * (q2 - auc ** 2)) / (n_pos * n_neg)
    se = math.sqrt(max(var, 0.0))
    return [_r(max(0.0, auc - 1.96 * se), 3), _r(min(1.0, auc + 1.96 * se), 3)]


def _models_block():
    metrics = ml_service._read_json("metrics.json") or {}
    reg = {m["model"]: m for m in ml_service.model_registry()}
    rows = []
    for name, m in reg.items():
        x = metrics.get(name) or {}
        bone_cv = x.get("chosen_cv") or x.get("logistic_regression_cv") or {}
        auc = next((x.get(k) for k in ("roc_auc", ) if isinstance(x.get(k), (int, float))), None)
        if auc is None and isinstance(bone_cv.get("macro_auc_ovr"), (int, float)):
            auc = bone_cv["macro_auc_ovr"]
        acc = x.get("accuracy", bone_cv.get("accuracy"))
        r2 = x.get("r2")
        n = x.get("n") or x.get("n_train") or x.get("n_windows") or x.get("n_train_windows") or x.get("n_samples")
        pos = x.get("positives") or x.get("positives_R+1")
        if pos is None and x.get("positive_rate") and n:
            pos = round(x["positive_rate"] * n)
        feats = x.get("n_features") or m["factor_count"]
        baseline = x.get("majority_baseline_accuracy")
        if baseline is None and "warning" in x:
            mb = re.search(r"(\d\.\d+) majority-class baseline", x["warning"])
            baseline = float(mb.group(1)) if mb else None
        if baseline is None and n and pos and name != "nhanes_bone_risk":
            baseline = max(pos, n - pos) / n
        ci = _hanley_ci(auc, pos, n - pos) if (auc and pos and n and name != "nhanes_bone_risk") else None
        if r2 is not None:
            verdict, tone = ("Worse than guessing the average" if r2 < 0 else "Explains some variation"), ("bad" if r2 < 0 else "mute")
        elif auc is not None:
            lo = ci[0] if ci else auc
            thin = bool(pos and feats and pos / feats < 1 and name != "nhanes_bone_risk")
            if auc < 0.55:
                verdict, tone = "No better than a coin flip", "bad"
            elif lo < 0.55:
                verdict, tone = "Some signal, but the interval reaches chance", "warn"
            elif thin:
                verdict, tone = "Promising, but far more inputs than rows", "warn"
            else:
                verdict, tone = "Real signal", "ok"
        else:
            verdict, tone = "Not a predictor", "mute"
        beats = None if baseline is None or acc is None else bool(acc > baseline)
        # Cells that used to be blank: every model gets a real value in each column.
        cc = x.get("class_counts") or {}
        evr = x.get("explained_variance_ratio")
        rpi = _r(n / feats, 2) if n and feats else None
        if pos and feats:
            ev_main, ev_sub = _r(pos / feats, 2), "positive rows per input"
        elif cc and feats:
            ev_main, ev_sub = _r(min(cc.values()) / feats, 2), "rows in the smallest class per input"
        else:
            ev_main, ev_sub = (_r(n / feats, 4) if n and feats and n / feats < 0.01 else rpi), "rows per input (no positive class to count)"
        if pos is not None:
            rows_sub = f"{pos} positive"
        elif cc:
            rows_sub = "classes: " + " / ".join(str(v) for v in cc.values())
        elif x.get("target_mean") is not None:
            rows_sub = f"target mean {x['target_mean']}, spread {x.get('target_sd')}"
        elif x.get("train_anomaly_rate") is not None:
            rows_sub = "no labels (unsupervised)"
        else:
            rows_sub = "no labels (unsupervised)"
        if auc is not None:
            auc_main, auc_sub = f"{auc:.2f}", (f"{ci[0]:.2f} to {ci[1]:.2f}" if ci else "macro one-vs-rest, 3 classes" if cc else "")
        elif r2 is not None:
            auc_main, auc_sub = f"R² {r2:.2f}", f"MAE {_r(x.get('mae'), 1)}"
        elif x.get("train_anomaly_rate") is not None:
            auc_main, auc_sub = f"{x['train_anomaly_rate'] * 100:.0f}% flagged", "share of training windows called unusual (set by design)"
        elif evr:
            auc_main, auc_sub = f"{sum(evr) * 100:.0f}% kept", f"variance explained by {len(evr)} components"
        else:
            auc_main, auc_sub = "Not scored", "no label to score against"
        if acc is not None:
            acc_main = f"{acc * 100:.0f}%"
            acc_sub = (f"naive {baseline * 100:.0f}% · {'beats it' if beats else 'does not beat it'}" if baseline is not None else "")
        elif x.get("mae") is not None and x.get("target_sd") is not None:
            acc_main, acc_sub = f"error {x['mae']} vs spread {x['target_sd']}", "typical miss vs how much the target varies; equal means no better than the average"
        elif x.get("user_4_anomaly_rate") is not None:
            acc_main, acc_sub = f"{x['user_4_anomaly_rate'] * 100:.0f}% of user_4", "held-out sensor-fault user flagged as unusual, which is the check passing"
        else:
            acc_main, acc_sub = "Not scored", f"{n} samples, no labels to count right or wrong" if n else "no labels to count right or wrong"
        cells = {"rows_sub": rows_sub, "events": ev_main, "events_sub": ev_sub, "auc": auc_main, "auc_sub": auc_sub, "acc": acc_main, "acc_sub": acc_sub}
        rows.append({"model": name, "short": name.replace("_logreg", "").replace("_isoforest", "").replace("_pca", ""), "predicts": m["predicts"], "population": m["population"],
                     "validation": m["validation"] or x.get("validation"), "n": n, "positives": pos, "features": feats,
                     "events_per_feature": _r(pos / feats, 2) if pos and feats else None, "auc": _r(auc, 3), "auc_ci": ci, "accuracy": _r(acc, 3), "baseline_accuracy": _r(baseline, 3),
                     "beats_baseline": beats, "r2": _r(r2, 3), "mae": _r(x.get("mae"), 1), "verdict": verdict, "tone": tone, "status": m["status"], "warning": m["warning"],
                     "used_in_check_day": m["used_in_check_day"], "cells": cells})
    if not rows:
        return None
    out = {"rows": rows, "reading": _models_reading(rows)}
    return out


def _models_reading(rows):
    cards = []
    ok = [r for r in rows if r["tone"] == "ok"]
    bad = [r for r in rows if r["tone"] == "bad"]
    cards.append({"tone": "mute", "title": f"{len(ok)} of {len(rows)} models show real signal", "evidence": "screening",
                  "text": "; ".join(f"{r['short']} (AUC {r['auc']:.2f})" for r in ok) + "." if ok else "None of the saved models clears its own uncertainty interval."})
    if bad:
        cards.append({"tone": "warn", "title": "Models that should not drive decisions", "evidence": "weak",
                      "text": "; ".join(f"{r['short']}: {r['verdict'].lower()}" for r in bad) + "."})
    thin = [r for r in rows if r["events_per_feature"] is not None and r["events_per_feature"] < 1]
    if thin:
        r = min(thin, key=lambda d: d["events_per_feature"])
        cards.append({"tone": "warn", "title": "Far more inputs than events", "evidence": "weak",
                      "text": f"{r['short']} has {r['positives']} positive rows and {r['features']} inputs ({r['events_per_feature']} events per input). A common guide is 10 or more, so its score is easy to overfit."})
    wide = [r for r in rows if r["auc_ci"] and (r["auc_ci"][1] - r["auc_ci"][0]) > 0.4]
    if wide:
        r = wide[0]
        cards.append({"tone": "mute", "title": "Small samples, wide intervals", "evidence": "weak",
                      "text": f"{r['short']}: AUC {r['auc']:.2f} could plausibly be anywhere from {r['auc_ci'][0]:.2f} to {r['auc_ci'][1]:.2f} with only {r['positives']} positive rows."})
    return cards


# ---------------------------------------------------------------------------------------------
def get_analytics_insight(db: Session, req: AnalyticsInsightRequest) -> dict:
    out: dict = {"selection": {"astronaut_id": req.astronaut_id, "days": req.days}}
    end = datetime.now(UTC)
    start = end - timedelta(days=req.days)
    logged = None
    if astronaut_repo.get(db, req.astronaut_id) is not None:
        df = _daily_frame(db, req.astronaut_id, start, end)
        if not df.empty:
            metrics = []
            for key, label, unit, _col, better, ref in METRICS:
                if key in df.columns:
                    b = _metric_block(key, label, unit, better, ref, df[key], end)
                    if b:
                        metrics.append(b)
            if metrics:
                first, last = df.index.min(), df.index.max()
                keys = [m["key"] for m in metrics]
                rel = _relations(df, keys) if len(keys) >= 2 else None
                if rel:
                    rel["reading"] = _relations_reading(rel)
                logged = {"window": {"start": start.date().isoformat(), "end": end.date().isoformat(), "days": req.days},
                          "coverage": _coverage(df, metrics, first, last), "metrics": metrics, "reading": _metrics_reading(metrics), "relations": rel}
        out["risk"] = _risk_block(db, req.astronaut_id, start, end)
    out["logged"] = logged
    out["blood"] = _blood_block()
    out["models"] = _models_block()
    out["disclaimer"] = "Decision support only. Not a diagnosis."
    return _clean(out)
