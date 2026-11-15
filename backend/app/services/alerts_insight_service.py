"""Factor-based alerts for the Risk Alerts page (POST /api/v1/ml/alerts-insight).

The existing page lists the flags raised by the check-day models (HRV, blood, sleep, stress, exercise). This module adds
alerts raised from the astronaut's OWN logged data, one rule per factor, so an alert always says what was measured, what
the line was, how long it has lasted and how strong the evidence behind the line is.

Factors (domains), each with its own rules:
  vitals           heart rate, SpO2, body temperature, systolic and diastolic blood pressure
  sleep            hours slept per night
  wellbeing        fatigue, stress, mood (0 to 10 self-report)
  cognition        reaction time and attention against the astronaut's OWN earlier baseline
  recovery         days without exercise, minutes in the last 7 days, and the "low exercise today" proxy flag
  musculoskeletal  body-map reports (severity 1 to 10, recurring, load-bearing regions)
  models           the check-day model flags (blood, HRV, sleep, stress), strong evidence weighs more
  compound         several areas outside their lines on the same days (the pattern matters more than any one value)

How a priority is decided (all lines are written in RULES below so the team can read and change them):
  * each reading is compared with tiered lines (low, medium, high, critical) taken from published references;
  * the most recent reading must be recent (STALE_DAYS) or the factor is reported as "not current", not alerted;
  * the same factor outside its line for PERSIST_DAYS readings in a row moves up one level (never above "high" by
    persistence alone, so only a measured value can be critical);
  * nothing here changes the Good / Warning / Critical level, which stays in app/ml/predict.py.

Nothing is typed in: the frontend only sends which data to read. A block that cannot be computed is left out.
"""
from collections import defaultdict
from datetime import UTC, datetime, timedelta

import numpy as np
import pandas as pd
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.ml import data_store
from app.repositories import alert_repo, astronaut_repo
from app.schemas.ml import AlertsInsightRequest
from app.services import analytics_insight_service as ais
from app.services import bone_muscle_insight_service as bmi
from app.services import ml_service
from app.services.vitals_insight_service import _clean

PRI = ["low", "medium", "high", "critical"]
STALE_DAYS = 3          # newest reading older than this = factor is "not current"
PERSIST_DAYS = 3        # readings in a row outside the line before the alert moves up a level
BASELINE_MIN_DAYS = 8   # earlier days needed to judge cognition against the astronaut's own baseline
RECENT_N = 3            # latest readings compared with the earlier baseline
INACTIVE_LOW, INACTIVE_MED, INACTIVE_HIGH = 3, 5, 7
WEEK_MIN_GROUND = 150   # WHO minimum minutes of moderate activity a week
COMPOUND_MIN_DOMAINS = 3

DOMAINS = [
    ("vitals", "Vital signs"), ("sleep", "Sleep"), ("wellbeing", "Mood, stress and fatigue"), ("cognition", "Cognition"),
    ("recovery", "Exercise and recovery"), ("musculoskeletal", "Muscle and bone symptoms"), ("blood", "Blood"), ("bone", "Bone screening"),
    ("models", "Model flags (blood, HRV)"), ("compound", "Several areas together"),
]
DOMAIN_NAME = dict(DOMAINS)

S = ais.SRC
SRC_NRS = "Numeric rating scale convention (0 to 10). Not a validated cut-off for this construct; replace with the instrument NASA uses."
SRC_TEMP_FEVER = "General clinical reference: fever is 38.0 C (100.4 F) or higher; 39.0 C or higher is a high fever."
SRC_SPO2 = "General clinical reference: normal SpO2 is 95 to 100%; under 90% is hypoxemia."
SRC_BP = "2017 ACC/AHA guideline: stage 1 is 130/80, stage 2 is 140/90, a crisis is above 180/120 mmHg."
SRC_HR = "General clinical reference: resting adult heart rate 60 to 100 bpm. Very fit people can sit below 50 without a problem."
SRC_SLEEP = "AASM/SRS consensus (2015): 7 or more hours; 6 or fewer is inadequate. ISS crews average about 6 h (Barger 2014)."
SRC_COG = "Own-baseline comparison: the latest readings against the astronaut's earlier readings, in standard deviations. Design choice, not a clinical cut-off."
SRC_EX = "WHO: at least 150 minutes of moderate activity a week. In flight the exercise routine is a countermeasure (NASA)."

# key, domain, label, frame column, unit, tiers [(op, threshold, priority)] most severe first, line text, source, evidence, action
RULES = [
    ("hr", "vitals", "Heart rate", "hr", "bpm", [(">", 120, "high"), (">", 100, "medium"), ("<", 40, "high"), ("<", 50, "medium")], "60 to 100 bpm", SRC_HR, "guideline",
     "Rest, then re-measure sitting still. If it stays outside 60 to 100, tell the medical officer."),
    ("spo2", "vitals", "Blood oxygen (SpO2)", "spo2", "%", [("<", 90, "critical"), ("<", 92, "high"), ("<", 95, "medium")], "95% or higher", SRC_SPO2, "guideline",
     "Check the sensor fit and re-measure. A reading that stays low needs the medical officer and a cabin air check."),
    ("temp", "vitals", "Body temperature", "temp", "C", [(">=", 39.0, "critical"), (">=", 38.0, "high"), (">=", 37.3, "low"), ("<", 35.5, "medium")], "36.1 to 37.2 C", SRC_TEMP_FEVER, "guideline",
     "Re-measure after 15 minutes of rest. Fever or a clearly low reading goes to the medical officer."),
    ("sys", "vitals", "Systolic blood pressure", "sys", "mmHg", [(">=", 180, "critical"), (">=", 160, "high"), (">=", 140, "medium"), (">=", 130, "low")], "under 120 mmHg", SRC_BP, "guideline",
     "Sit quietly for five minutes and re-measure. Repeated high readings go to the medical officer."),
    ("dia", "vitals", "Diastolic blood pressure", "dia", "mmHg", [(">=", 120, "critical"), (">=", 100, "high"), (">=", 90, "medium"), (">=", 80, "low")], "under 80 mmHg", SRC_BP, "guideline",
     "Sit quietly for five minutes and re-measure. Repeated high readings go to the medical officer."),
    ("sleep", "sleep", "Sleep", "sleep", "h", [("<=", 4, "high"), ("<=", 6, "medium"), ("<", 7, "low")], "7 h or more", SRC_SLEEP, "guideline",
     "Protect the next sleep period: fixed lights-out, dim light for the last hour, no hard training late."),
    ("fatigue", "wellbeing", "Fatigue", "fatigue", "/10", [(">=", 9, "high"), (">=", 7, "medium")], "under 7 of 10", SRC_NRS, "convention",
     "Lighten the schedule if you can, add a rest block and check last night's sleep."),
    ("stress", "wellbeing", "Stress", "stress", "/10", [(">=", 9, "high"), (">=", 7, "medium")], "under 7 of 10", SRC_NRS, "convention",
     "Take a short break, talk to a crew member or ground contact, and keep the sleep routine."),
    ("mood", "wellbeing", "Mood", "mood", "/10", [("<=", 2, "high"), ("<=", 3, "medium")], "above 3 of 10", SRC_NRS, "convention",
     "Plan one contact with family or the ground team today and keep the routine. Persistent low mood goes to the medical officer."),
]
RULE = {r[0]: r for r in RULES}
OPS = {">": lambda v, t: v > t, ">=": lambda v, t: v >= t, "<": lambda v, t: v < t, "<=": lambda v, t: v <= t}
WORDS = {">": "above", ">=": "at or above", "<": "below", "<=": "at or below"}


def _r(x, nd=1):
    return ais._r(x, nd)


def _tier(rule, value):
    """Most severe tier the value falls in: (priority, op, threshold) or None."""
    for op, thr, pri in rule[5]:
        if OPS[op](value, thr):
            return pri, op, thr
    return None


def _u(unit):
    """Unit with the right spacing: 95%, 7/10, 108 bpm."""
    return unit if unit in ("%", "/10", "/100") else (f" {unit}" if unit else "")


def _bump(pri):
    i = PRI.index(pri)
    return PRI[min(i + 1, 2)] if i < 2 else pri   # persistence can lift low/medium to at most high


def _action(base, pri):
    if pri in ("high", "critical"):
        return "Tell the mission medical officer today. " + base
    return base


SRC_EFF = "Sleep consensus (Ohayon et al., Sleep Health 2017): sleep efficiency of 85% or more is good."
SRC_WASO = "Sleep consensus (Ohayon et al., Sleep Health 2017): about 30 minutes or less awake after falling asleep is the usual upper end."
SRC_STAI = "Spielberger STAI (20 to 80): 40 or more is the common cut-off for clinically significant anxiety symptoms (Julian 2011)."
SRC_PSQI = "Buysse et al. 1989: a global Pittsburgh Sleep Quality Index above 5 means poor sleep quality."
SRC_HRV = "Backend convention for HRV windows: RMSSD under 30 ms marks a low-recovery window. Not a clinical cut-off."
SRC_STRESS = "Backend flag line: the check-day model flags a daily stress score above 50 (weak evidence)."

# Rules for the data selected on the page (MMASH volunteer, HRV windows). Same shape as RULES; "col" is a key in the selection values.
DAY_RULES = [
    ("d_sleep", "sleep", "Sleep (measured night)", "sleep_h", "h", [("<=", 4, "high"), ("<=", 6, "medium"), ("<", 7, "low")], "7 h or more", SRC_SLEEP, "guideline",
     "Protect the next sleep period: fixed lights-out, dim light for the last hour, no hard training late."),
    ("d_eff", "sleep", "Sleep efficiency", "eff", "%", [("<", 65, "high"), ("<", 75, "medium"), ("<", 85, "low")], "85% or more", SRC_EFF, "guideline",
     "Keep the bed for sleep: same lights-out, a darker and cooler sleep station, no screens in the last hour."),
    ("d_waso", "sleep", "Time awake after falling asleep", "waso", "min", [(">", 90, "high"), (">", 60, "medium"), (">", 30, "low")], "30 min or less", SRC_WASO, "convention",
     "Look at what wakes you (noise, light, temperature) and fix that first. Avoid caffeine in the second half of the day."),
    ("d_psqi", "sleep", "Sleep quality questionnaire (PSQI)", "psqi", "", [(">", 10, "medium"), (">", 5, "low")], "5 or under", SRC_PSQI, "guideline",
     "Keep a simple sleep log for a week and bring it to the next medical conference."),
    ("d_stress", "wellbeing", "Daily stress score", "stress", "/100", [(">", 80, "high"), (">", 50, "medium")], "50 or under", SRC_STRESS, "convention",
     "Take a short break, talk to a crew member or ground contact, and keep the sleep routine."),
    ("d_stai1", "wellbeing", "State anxiety (STAI)", "stai1", "", [(">=", 55, "high"), (">=", 45, "medium"), (">=", 40, "low")], "under 40", SRC_STAI, "convention",
     "Try a short breathing or relaxation block and plan a call with family or the ground team."),
    ("d_stai2", "wellbeing", "Trait anxiety (STAI)", "stai2", "", [(">=", 55, "high"), (">=", 45, "medium"), (">=", 40, "low")], "under 40", SRC_STAI, "convention",
     "A lasting pattern rather than one day: raise it at the next medical conference."),
    ("d_rmssd", "vitals", "Heart-rate variability (RMSSD)", "rmssd", "ms", [("<", 20, "medium"), ("<", 30, "low")], "30 ms or more", SRC_HRV, "convention",
     "Low variability can mean poor recovery. Prioritise sleep and an easier training day."),
    ("d_lowhrv", "vitals", "Windows with low HRV", "low_hrv_share", "%", [(">=", 60, "medium"), (">=", 40, "low")], "under 40% of windows", SRC_HRV, "convention",
     "Recovery looks poor across the recording. Lighten the load and repeat the recording at rest."),
]
DAY_RULE = {r[0]: r for r in DAY_RULES}
NEAR_MARGIN = 0.10   # a value within 10% of a line (on the safe side) goes on the watch list


def _near(rule, value):
    """(distance in % of the line, op, threshold) when the value is on the safe side of a line but within NEAR_MARGIN of it."""
    best = None
    for op, thr, _p in rule[5]:
        if not thr:
            continue
        d = abs(value - thr) / abs(thr)
        if op in (">", ">=") and value < thr and d <= NEAR_MARGIN:
            cand = (d, op, thr)
        elif op in ("<", "<=") and value > thr and d <= NEAR_MARGIN:
            cand = (d, op, thr)
        else:
            continue
        if best is None or cand[0] < best[0]:
            best = cand
    return best


def _watch_item(rule, value, op, thr, dist):
    label, unit = rule[2], rule[4]
    side = "below" if op in (">", ">=") else "above"
    return {"id": f"watch_{rule[0]}", "domain": rule[1], "factor": label, "value": _r(value, 2), "unit": unit, "line": rule[6], "distance_pct": _r(dist * 100, 1),
            "text": f"{label} is {_r(value, 2):g}{_u(unit)}" + f", {_r(dist * 100, 0):g}% {side} its line ({WORDS[op]} {thr:g}) and not over it yet.", "evidence": rule[8]}


def _selection_values(req, d):
    """Numbers for the data selected on the page: the MMASH volunteer's night and questionnaires, the HRV windows."""
    chosen, _subject, _scenario = ml_service._merge_defaults(req)
    _mu, _hu, mrow, windows, _insp, _osd = ml_service._rows_from_data(chosen)
    vals, who = {}, {}
    if mrow is not None:
        r = mrow.iloc[0]

        def g(c):
            v = r.get(c)
            try:
                v = float(v)
            except (TypeError, ValueError):
                return None
            return v if np.isfinite(v) else None
        m = g("total_sleep_minutes")
        vals.update({"sleep_h": m / 60 if m is not None else None, "eff": g("sleep_efficiency_percent"), "waso": g("total_waso_minutes"), "psqi": g("Pittsburgh"),
                     "stress": g("Daily_stress"), "stai1": g("STAI1"), "stai2": g("STAI2"), "rmssd": g("hrv_mean_rr_rmssd_ms")})
        who = {"volunteer": _mu}
    if windows is not None and "rr_rmssd_ms" in windows.columns and len(windows):
        vals["low_hrv_share"] = float((windows["rr_rmssd_ms"] < 30).mean() * 100)
    return vals, who


def _day_alerts(vals, who, watch, readings):
    out = []
    src_note = f" (MMASH volunteer {who['volunteer']}, an Earth volunteer)" if who.get("volunteer") else ""
    for key, domain, label, col, unit, tiers, line, src, evid, act in DAY_RULES:
        v = vals.get(col)
        if v is None:
            continue
        readings.append({"id": key, "domain": domain, "factor": label, "shown": (f"{v:.0f}" if abs(v) >= 100 else f"{v:.1f}") + _u(unit), "line": line, "evidence": evid, "source": "selected data"})
        t = _tier(DAY_RULE[key], v)
        if not t:
            n = _near(DAY_RULE[key], v)
            if n:
                watch.append(_watch_item(DAY_RULE[key], v, n[1], n[2], n[0]))
            continue
        pri, op, thr = t
        shown = f"{v:.0f}" if abs(v) >= 100 else f"{v:.1f}"
        out.append({"id": key, "domain": domain, "factor": label, "title": f"{label} {WORDS[op]} {thr:g}{_u(unit)}",
                    "message": f"{label} is {shown}{_u(unit)}{src_note}. The line is {line}. One snapshot, so how long it lasts is not known.",
                    "priority": pri, "base_priority": pri, "escalated": False, "observed": _r(v, 2), "unit": unit, "line": line, "run": 1, "since": None, "last_reading": None,
                    "evidence": evid, "source": src, "action": _action(act, pri), "kind": "data"})
    return out


def _blood_bone_alerts(d, readings):
    out = []
    ch = d.get("baseline_changes") or []
    if ch:
        top = ch[0]
        big = abs(top["percent_change"])
        readings.append({"id": "blood_shift", "domain": "blood", "factor": "Blood values vs own pre-flight", "shown": f"{top['percent_change']:+.0f}% ({top['marker']})", "line": "within 20% of the own pre-flight average", "evidence": "proxy", "source": "selected data"})
        pri = "high" if big >= 50 else "medium" if big >= 30 else "low" if big >= 20 else None
        if pri:
            lst = "; ".join(f"{c['marker']} {c['percent_change']:+.0f}%" for c in ch[:3])
            out.append({"id": "blood_shift", "domain": "blood", "factor": "Blood values vs own pre-flight", "title": f"Largest blood shift is {top['percent_change']:+.0f}% from your own pre-flight average",
                        "message": f"Biggest changes against the astronaut's own pre-flight mean: {lst}. Changes after landing are expected in part; the size and the number of markers moving together is what matters.",
                        "priority": pri, "base_priority": pri, "escalated": False, "observed": top["percent_change"], "unit": "%", "line": "within 20% of the own pre-flight average", "run": 1, "since": None,
                        "last_reading": None, "evidence": "proxy", "source": "Own-baseline comparison (Inspiration4 serum values). Not a clinical reference range.",
                        "action": _action("Ask the medical officer whether the blood work should be repeated and which markers to watch.", pri), "kind": "data"})
    bone = d.get("bone_risk")
    if bone and bone.get("bone_risk_label"):
        readings.append({"id": "bone_screen", "domain": "bone", "factor": "Bone-risk screening", "shown": bone["bone_risk_label"], "line": "Low class", "evidence": "screening", "source": "selected data"})
    if bone and bone.get("bone_risk_label") in ("Medium", "High"):
        high = bone["bone_risk_label"] == "High"
        p = (bone.get("probabilities") or {}).get(bone["bone_risk_label"])
        out.append({"id": "bone_screen", "domain": "bone", "factor": "Bone-risk screening", "title": f"Bone-risk screening says {bone['bone_risk_label']}",
                    "message": f"The saved screening model puts this profile in the {bone['bone_risk_label']} class" + (f" (probability {p:.2f})" if p is not None else "") + ". It was trained on US adults 40 to 80, not astronauts, so it is a screening flag only.",
                    "priority": "high" if high else "low", "base_priority": "high" if high else "low", "escalated": False, "observed": p, "unit": "", "line": "Low class", "run": 1, "since": None, "last_reading": None,
                    "evidence": "screening", "source": "NHANES 2013-2014 screening model; see the Bone & Muscle page for the full breakdown.",
                    "action": _action("Keep resistive exercise in every week and review the Bone & Muscle page for what moves the result.", "high" if high else "low"), "kind": "data"})
    return out


# ---------------------------------------------------------------------------------------------
# alerts from the logged daily values
# ---------------------------------------------------------------------------------------------
def _threshold_alerts(df: pd.DataFrame, end_day, stale: list, watch: list, readings: list):
    alerts, timeline_hits = [], defaultdict(list)   # timeline_hits[date] -> [(rule key, priority, value)]
    for key, domain, label, col, unit, tiers, line, src, evid, act in RULES:
        if col not in df.columns:
            continue
        s = df[col].dropna()
        if s.empty:
            continue
        for d, v in s.items():
            t = _tier(RULE[key], float(v))
            if t:
                timeline_hits[d.date().isoformat()].append((key, t[0], float(v)))
        last_day = s.index[-1].date()
        age = (end_day - last_day).days
        if age > STALE_DAYS:
            stale.append({"factor": label, "last_reading": last_day.isoformat(), "days_ago": age})
            continue
        latest = float(s.iloc[-1])
        readings.append({"id": key, "domain": domain, "factor": label, "shown": f"{latest:g}{_u(unit)}", "line": line, "evidence": evid, "source": "your logs"})
        t = _tier(RULE[key], latest)
        if not t:
            n = _near(RULE[key], latest)
            if n:
                watch.append(_watch_item(RULE[key], latest, n[1], n[2], n[0]))
            continue
        pri, op, thr = t
        run = 0
        for v in s.iloc[::-1]:
            if _tier(RULE[key], float(v)):
                run += 1
            else:
                break
        base_pri = pri
        escalated = False
        if run >= PERSIST_DAYS and pri != "critical":
            lifted = _bump(pri)
            escalated = lifted != pri
            pri = lifted
        since = s.index[len(s) - run].date().isoformat() if run else last_day.isoformat()
        title = f"{label} {WORDS[op]} {thr:g}{(' ' + unit) if unit and unit != '/10' else ''}" + (" of 10" if unit == "/10" else "")
        sp = f"{latest:g}" + (f" {unit}" if unit and unit != "/10" else " of 10" if unit == "/10" else "")
        msg = f"Latest {label.lower().replace('spo2', 'SpO2')} is {sp} (line: {line}). " + (f"Outside the line for {run} readings in a row, since {since}." if run > 1 else "One reading outside the line so far.")
        if escalated:
            msg += f" Raised from {base_pri} to {pri} because it lasted {PERSIST_DAYS} or more readings."
        alerts.append({"id": f"{key}", "domain": domain, "factor": label, "title": title, "message": msg, "priority": pri, "base_priority": base_pri, "escalated": escalated,
                       "observed": _r(latest, 2), "unit": unit, "line": line, "run": run, "since": since, "last_reading": last_day.isoformat(), "evidence": evid,
                       "source": src, "action": _action(act, pri), "kind": "reading"})
    return alerts, timeline_hits


def _cognition_alerts(df: pd.DataFrame, end_day, stale: list, readings: list):
    out = []
    for key, label, col, unit, sign in (("reaction", "Reaction time", "reaction", "ms", 1), ("attention", "Attention score", "attention", "/100", -1)):
        if col not in df.columns:
            continue
        s = df[col].dropna()
        if len(s) < BASELINE_MIN_DAYS + RECENT_N:
            continue
        last_day = s.index[-1].date()
        age = (end_day - last_day).days
        if age > STALE_DAYS:
            stale.append({"factor": label, "last_reading": last_day.isoformat(), "days_ago": age})
            continue
        base, recent = s.iloc[:-RECENT_N], s.iloc[-RECENT_N:]
        sd = float(base.std(ddof=1))
        if not sd or not np.isfinite(sd):
            continue
        z = sign * (float(recent.mean()) - float(base.mean())) / sd     # positive = worse than own baseline
        readings.append({"id": key, "domain": "cognition", "factor": label, "shown": f"{float(recent.mean()):.0f} {unit}", "line": f"within 1 spread of your own earlier average ({float(base.mean()):.0f} {unit})", "evidence": "convention", "source": "your logs"})
        pri = "high" if z >= 2 else "medium" if z >= 1 else None
        if not pri:
            continue
        word = "slower" if sign == 1 else "lower"
        out.append({"id": key, "domain": "cognition", "factor": label, "title": f"{label} {word} than your own baseline",
                    "message": f"The last {RECENT_N} readings average {float(recent.mean()):.0f} {unit} against {float(base.mean()):.0f} {unit} before, which is {z:.1f} of your own spreads ({sd:.0f} {unit}) in the worse direction.",
                    "priority": pri, "base_priority": pri, "escalated": False, "observed": _r(float(recent.mean()), 1), "unit": unit,
                    "line": f"within 1 spread of your own earlier average ({float(base.mean()):.0f} {unit})", "run": RECENT_N, "since": recent.index[0].date().isoformat(),
                    "last_reading": last_day.isoformat(), "evidence": "convention", "source": SRC_COG,
                    "action": _action("Repeat the cognitive test after rest. If it stays worse, lighten safety-critical tasks and check sleep and fatigue.", pri), "kind": "reading"})
    return out


def _recovery_alerts(df: pd.DataFrame, end_day):
    if "exercise" not in df.columns or df["exercise"].dropna().empty:
        return []
    ex = df["exercise"].dropna()
    ex = ex[ex > 0]
    if ex.empty:
        return []
    out = []
    since_last = (end_day - ex.index[-1].date()).days
    pri = "high" if since_last >= INACTIVE_HIGH else "medium" if since_last >= INACTIVE_MED else "low" if since_last >= INACTIVE_LOW else None
    if pri:
        out.append({"id": "inactivity", "domain": "recovery", "factor": "Exercise", "title": f"No exercise logged for {since_last} days",
                    "message": f"The last logged session was on {ex.index[-1].date().isoformat()}. In flight the exercise routine is the main countermeasure against bone and muscle loss, so long gaps matter.",
                    "priority": pri, "base_priority": pri, "escalated": False, "observed": since_last, "unit": "days", "line": f"under {INACTIVE_LOW} days between sessions", "run": since_last,
                    "since": ex.index[-1].date().isoformat(), "last_reading": ex.index[-1].date().isoformat(), "evidence": "proxy", "source": SRC_EX,
                    "action": _action("Fit in a session today, resistive work first if you have only one. Log it so the weekly view is right.", pri), "kind": "reading"})
    exs = df["exercise"].dropna()
    week = float(exs[exs.index > (pd.Timestamp(end_day) - pd.Timedelta(days=7))].sum())
    span_ok = len(df) >= 7
    if span_ok and week < WEEK_MIN_GROUND and not out:
        out.append({"id": "weekly_minutes", "domain": "recovery", "factor": "Exercise", "title": f"Only {week:.0f} minutes of exercise in the last 7 days",
                    "message": f"The last 7 days add up to {week:.0f} minutes. The ground guideline is {WEEK_MIN_GROUND} minutes a week.", "priority": "low", "base_priority": "low", "escalated": False,
                    "observed": week, "unit": "min", "line": f"{WEEK_MIN_GROUND} min a week or more", "run": 7, "since": (pd.Timestamp(end_day) - pd.Timedelta(days=6)).date().isoformat(),
                    "last_reading": ex.index[-1].date().isoformat(), "evidence": "proxy", "source": SRC_EX,
                    "action": "Add one or two sessions this week; short ones count.", "kind": "reading"})
    return out


def _msk_alerts(db, astronaut_id, days):
    try:
        m = bmi._msk_block(db, astronaut_id, days)
    except AppError:
        return []
    if not m:
        return []
    out = []
    for r in m["regions"]:
        sev = r["latest_severity"]
        pri = "high" if sev >= 8 else "medium" if sev >= 6 else "low" if sev >= 4 else None
        if pri is None:
            continue
        if r["recurring"] and pri != "high":
            pri = PRI[PRI.index(pri) + 1]
        trend = f", {r['trend']}" if r.get("trend") not in (None, "insufficient_data") else ""
        out.append({"id": f"msk_{r['code']}", "domain": "musculoskeletal", "factor": r["name"], "title": f"{r['name']}: severity {sev} of 10" + (" and recurring" if r["recurring"] else ""),
                    "message": f"{r['count']} report{'s' if r['count'] != 1 else ''} in {days} days, latest {sev}/10, worst {r['max_severity']}/10{trend}." + (" This is a load-bearing region." if r["load_bearing"] else ""),
                    "priority": pri, "base_priority": pri, "escalated": False, "observed": sev, "unit": "/10", "line": "under 4 of 10 and not recurring", "run": r["count"],
                    "since": r["latest_reported_at"][:10], "last_reading": r["latest_reported_at"][:10], "evidence": "proxy",
                    "source": "Self-reported body-map severity (1 to 10). Not a diagnosis.",
                    "action": _action("Reduce load on that area, note what triggers it and add it to the next medical conference.", pri), "kind": "report"})
    return out


# ---------------------------------------------------------------------------------------------
# alerts from the check-day models
# ---------------------------------------------------------------------------------------------
MODEL_FLAGS = [   # text starts with, id, domain, factor
    ("Poor sleep likely", "model_sleep", "models", "Sleep model"),
    ("High stress", "model_stress", "models", "Stress model"),
    ("Unusual HRV", "model_hrv", "models", "HRV anomaly detector"),
    ("Blood looks", "model_blood", "models", "Blood model"),
    ("Low exercise today", "model_exercise", "recovery", "Exercise (proxy)"),
]
MODEL_ACTION = {
    "model_sleep": "Treat as a prompt to protect sleep tonight. The sleep model is weak evidence.",
    "model_stress": "Plan a short break and a check-in. The stress model is weak evidence.",
    "model_hrv": "Repeat the HRV recording at rest and tell the medical officer if it persists. This flag is strong evidence.",
    "model_blood": "Ask the medical officer whether the blood work should be repeated. This flag is strong evidence.",
    "model_exercise": "Add a session today. This is a proxy flag only.",
}


def _model_alerts(day: dict):
    out = []
    for text in day.get("flags") or []:
        for prefix, mid, domain, factor in MODEL_FLAGS:
            if text.startswith(prefix):
                strong = "strong evidence" in text
                pri = "high" if strong else "low"
                out.append({"id": mid, "domain": domain, "factor": factor, "title": text.split(" [")[0], "message": text,
                            "priority": pri, "base_priority": pri, "escalated": False, "observed": None, "unit": "", "line": "model flag line (see the model's own card)", "run": 1,
                            "since": None, "last_reading": None, "evidence": "strong" if strong else "weak",
                            "source": "Saved model result for the data selected on the page.", "action": _action(MODEL_ACTION[mid], pri), "kind": "model"})
                break
    return out


# ---------------------------------------------------------------------------------------------
# compound pattern, timeline, board
# ---------------------------------------------------------------------------------------------
def _compound(alerts):
    live = [a for a in alerts if a["kind"] in ("reading", "report", "data") and PRI.index(a["priority"]) >= 1]
    doms = sorted({a["domain"] for a in live})
    out = []
    if len(doms) >= COMPOUND_MIN_DOMAINS:
        pri = "high" if len(doms) >= 4 or any(a["priority"] in ("high", "critical") for a in live) else "medium"
        out.append({"id": "compound_many", "domain": "compound", "factor": "Several areas",
                    "title": f"{len(doms)} areas are outside their lines at the same time",
                    "message": "Outside the line now: " + "; ".join(f"{DOMAIN_NAME[d].lower()} ({', '.join(a['factor'].lower() for a in live if a['domain'] == d)})" for d in doms) + ". One drifting value is common; several together is a pattern worth a conversation.",
                    "priority": pri, "base_priority": pri, "escalated": False, "observed": len(doms), "unit": "areas", "line": f"fewer than {COMPOUND_MIN_DOMAINS} areas at once", "run": len(doms),
                    "since": min((a["since"] for a in live if a["since"]), default=None), "last_reading": None, "evidence": "convention",
                    "source": "Design choice: several factors outside their lines together move the picture up.",
                    "action": _action("Take a lighter schedule for a day, protect sleep, and bring the whole picture to the medical conference rather than one value.", pri),
                    "kind": "compound", "members": [a["id"] for a in live]})
    keys = {a["id"] for a in live}
    if {"sleep", "stress"} <= keys or {"sleep", "fatigue"} <= keys:
        extra = [k for k in ("hr", "reaction", "attention", "mood") if k in keys]
        if extra and not out:
            out.append({"id": "compound_fatigue", "domain": "compound", "factor": "Sleep, strain and load",
                        "title": "Short sleep with strain showing up elsewhere",
                        "message": "Sleep is under its line together with stress or fatigue" + (f" and {', '.join(RULE[k][2].lower() if k in RULE else k for k in extra)}" if extra else "") + ". This is the usual shape of accumulated fatigue.",
                        "priority": "medium", "base_priority": "medium", "escalated": False, "observed": None, "unit": "", "line": "sleep, strain and load each inside their lines", "run": 1, "since": None, "last_reading": None,
                        "evidence": "convention", "source": "Design choice, built from the individual rules above.",
                        "action": "Make sleep the first priority for the next two nights and reduce non-essential tasks.", "kind": "compound", "members": sorted(keys & {"sleep", "stress", "fatigue", *extra})})
    return out


def _timeline(hits, df_index, start_day, end_day):
    rows = []
    day = start_day
    have = {d.date().isoformat() for d in df_index}
    while day <= end_day:
        iso = day.isoformat()
        if iso in have:
            cnt = {p: 0 for p in PRI}
            for _k, p, _v in hits.get(iso, []):
                cnt[p] += 1
            rows.append({"date": iso, **cnt, "total": sum(cnt.values()),
                         "items": [{"factor": RULE[k][2], "priority": p, "value": _r(v, 2), "unit": RULE[k][4]} for k, p, v in sorted(hits.get(iso, []), key=lambda t: -PRI.index(t[1]))][:6]})
        day += timedelta(days=1)
    return rows


def _heat(hits, df_index, start_day, end_day):
    domains = [("vitals", "Vital signs"), ("sleep", "Sleep"), ("wellbeing", "Mood, stress, fatigue")]
    days = [d.date().isoformat() for d in df_index]
    dom_of = {k: RULE[k][1] for k in RULE}
    rows = []
    for dk, dl in domains:
        cells = []
        for iso in days:
            items = [(k, p, v) for k, p, v in hits.get(iso, []) if dom_of[k] == dk]
            worst = max((PRI.index(p) for _k, p, _v in items), default=-1)
            cells.append({"date": iso, "level": worst, "items": [{"factor": RULE[k][2], "priority": p, "value": _r(v, 2), "unit": RULE[k][4]} for k, p, v in items]})
        rows.append({"domain": dk, "label": dl, "cells": cells})
    return rows if days else []


def _board(alerts, checked):
    out = []
    for dk, dl in DOMAINS:
        mine = [a for a in alerts if a["domain"] == dk]
        if not mine and dk not in checked:
            continue
        worst = max(mine, key=lambda a: PRI.index(a["priority"])) if mine else None
        out.append({"domain": dk, "label": dl, "status": worst["priority"] if worst else "clear", "count": len(mine), "top": worst["title"] if worst else None,
                    "evidence": worst["evidence"] if worst else None, "factors": [a["factor"] for a in mine]})
    return out


def _engine_alerts(db, astronaut_id):
    items, total = alert_repo.list_for_astronaut(db, astronaut_id, 0, 50, "open", None)
    if not items:
        return None
    now = datetime.now(UTC)

    def age_h(a):
        c = a.created_at if a.created_at.tzinfo else a.created_at.replace(tzinfo=UTC)
        return max(0.0, (now - c).total_seconds() / 3600)
    return {"total_open": total, "items": [{"id": a.id, "priority": a.priority, "title": a.title, "message": a.message, "created_at": a.created_at.isoformat(), "age_hours": _r(age_h(a), 1)} for a in items[:20]],
            "by_priority": {p: sum(1 for a in items if a.priority == p) for p in PRI}}


def _reading(alerts, kpis, timeline, watch=None):
    cards = []
    if not alerts:
        if watch:
            w = watch[0]
            return [{"tone": "warn", "title": f"Nothing over a line, but {len(watch)} factor{'s are' if len(watch) != 1 else ' is'} close", "evidence": w["evidence"],
                     "text": f"Closest: {w['text']}"}]
        return [{"tone": "ok", "title": "No factor is outside its line", "text": "Every checked factor is inside its reference line on the latest readings.", "evidence": "guideline"}]
    watch = watch or []
    top = sorted([a for a in alerts if a["kind"] != "compound"] or alerts, key=lambda a: (-PRI.index(a["priority"]), -a["run"]))
    t = top[0]
    cards.append({"tone": "bad" if t["priority"] in ("high", "critical") else "warn", "title": f"Most important: {t['title'].lower()}", "evidence": t["evidence"], "text": t["message"]})
    if watch:
        cards.append({"tone": "mute", "title": f"{len(watch)} more close to their line", "evidence": watch[0]["evidence"], "text": "Not alerting yet: " + "; ".join(f"{w['factor']} ({w['distance_pct']:g}% away)" for w in watch[:3]) + "."})
    long_ = [a for a in alerts if a["run"] >= PERSIST_DAYS and a["kind"] == "reading"]
    if long_:
        a = max(long_, key=lambda a: a["run"])
        cards.append({"tone": "warn", "title": "Lasting, not a blip", "evidence": "convention", "text": f"{a['factor']} has been outside its line for {a['run']} {'days' if a['unit'] == 'days' else 'readings in a row'}. {len(long_)} factor{'s' if len(long_) != 1 else ''} lasted {PERSIST_DAYS} or more."})
    if len(kpis["domains_with_alert"]) >= 2:
        cards.append({"tone": "warn", "title": "More than one area", "evidence": "convention", "text": "Alerts are in " + ", ".join(DOMAIN_NAME[d].lower() for d in kpis["domains_with_alert"]) + ". Look at them together, not one by one."})
    if timeline and len(timeline) >= 6:
        half = len(timeline) // 2
        a, b = sum(r["total"] for r in timeline[:half]) / half, sum(r["total"] for r in timeline[half:]) / (len(timeline) - half)
        if b > a * 1.3 + 0.2:
            cards.append({"tone": "bad", "title": "More readings outside their lines lately", "evidence": "convention", "text": f"Per logged day: {a:.1f} in the first half of the window, {b:.1f} in the second."})
        elif a > b * 1.3 + 0.2:
            cards.append({"tone": "ok", "title": "Fewer readings outside their lines lately", "evidence": "convention", "text": f"Per logged day: {a:.1f} in the first half of the window, {b:.1f} in the second."})
    return cards


# ---------------------------------------------------------------------------------------------
def build_alerts(db: Session, req: AlertsInsightRequest) -> dict:
    """Everything the advice module needs too (kept as one function so page and AI always see the same alerts)."""
    end = datetime.now(UTC)
    start = end - timedelta(days=req.days)
    end_day = end.date()
    alerts, stale, checked, timeline, heat, watch, readings = [], [], set(), [], [], [], []
    has_astro = astronaut_repo.get(db, req.astronaut_id) is not None
    df = pd.DataFrame()
    if has_astro:
        df = ais._daily_frame(db, req.astronaut_id, start, end)
    if not df.empty:
        a1, hits = _threshold_alerts(df, end_day, stale, watch, readings)
        alerts += a1 + _cognition_alerts(df, end_day, stale, readings) + _recovery_alerts(df, end_day)
        for _k, domain, _l, col, *_rest in RULES:
            if col in df.columns and not df[col].dropna().empty:
                checked.add(domain)
        if any(c in df.columns for c in ("reaction", "attention")):
            checked.add("cognition")
        if "exercise" in df.columns:
            checked.add("recovery")
        timeline = _timeline(hits, df.index, start.date(), end_day)
        heat = _heat(hits, df.index, start.date(), end_day)
    if has_astro:
        msk = _msk_alerts(db, req.astronaut_id, req.days)
        alerts += msk
        if msk or bmi._msk_block(db, req.astronaut_id, req.days):
            checked.add("musculoskeletal")
    day_level, day_flags, missing = None, [], []
    try:
        d = ml_service.run_day(req)
        cd = d["check_day"]
        day_level, day_flags, missing = d["level"], cd.get("flags") or [], cd.get("missing") or []
        model_alerts = _model_alerts(cd)
        try:
            vals, who = _selection_values(req, d)
        except (AppError, Exception):   # noqa: BLE001 - no MMASH row or HRV windows selected; the rest still stands
            vals, who = {}, {}
        day_alerts = _day_alerts(vals, who, watch, readings) + _blood_bone_alerts(d, readings)
        if any(a["id"] == "d_stress" for a in day_alerts):
            model_alerts = [m for m in model_alerts if m["id"] != "model_stress"]   # same fact, do not list it twice
        alerts += day_alerts + model_alerts
        for _k, domain, _l, col, *_rest in DAY_RULES:
            if vals.get(col) is not None:
                checked.add(domain)
        if d.get("baseline_changes"):
            checked.add("blood")
        if d.get("bone_risk"):
            checked.add("bone")
        checked.add("models")
    except (AppError, Exception):   # noqa: BLE001 - the model selection can be empty; the logged alerts still stand
        pass
    alerts += _compound(alerts)
    alerts.sort(key=lambda a: (-PRI.index(a["priority"]), -(a["run"] or 0)))
    by_id = {a["id"]: a["priority"] for a in alerts}
    near = {w["id"] for w in watch}
    for r in readings:
        r["status"] = by_id.get(r["id"]) or ("watch" if f"watch_{r['id']}" in near else "ok")
    order = {"critical": 0, "high": 1, "medium": 2, "low": 3, "watch": 4, "ok": 5}
    readings.sort(key=lambda r: (order[r["status"]], r["factor"]))
    watch.sort(key=lambda w: w["distance_pct"])
    return {"alerts": alerts, "watch": watch, "readings": readings, "stale": stale, "checked": checked, "timeline": timeline, "heat": heat, "day_level": day_level, "has_logged": not df.empty,
            "window": {"start": start.date().isoformat(), "end": end_day.isoformat(), "days": req.days}}


def get_alerts_insight(db: Session, req: AlertsInsightRequest) -> dict:
    b = build_alerts(db, req)
    alerts = b["alerts"]
    by_pri = {p: sum(1 for a in alerts if a["priority"] == p) for p in PRI}
    doms = [dk for dk, _ in DOMAINS if dk != "compound" and any(a["domain"] == dk for a in alerts)]
    longest = max((a for a in alerts if a["kind"] == "reading"), key=lambda a: a["run"], default=None)
    tl = b["timeline"]
    days_with_alert = sum(1 for r in tl if r["total"] > 0)
    kpis = {"total": len(alerts), "by_priority": by_pri, "domains_with_alert": doms, "domains_checked": len(b["checked"]),
            "highest": max((a["priority"] for a in alerts), key=PRI.index, default=None),
            "longest": {"factor": longest["factor"], "run": longest["run"]} if longest and longest["run"] > 1 else None,
            "alert_days": days_with_alert, "logged_days": len(tl), "watch": len(b["watch"]), "factors_checked": len(b["checked"])}
    out = {"selection": {"astronaut_id": req.astronaut_id, "days": req.days}, "window": b["window"], "kpis": kpis, "alerts": alerts,
           "board": _board(alerts, b["checked"]), "timeline": tl or None, "heat": b["heat"] or None, "stale": b["stale"] or None, "watch": b["watch"] or None, "readings": b["readings"] or None,
           "engine": _engine_alerts(db, req.astronaut_id) if astronaut_repo.get(db, req.astronaut_id) is not None else None,
           "reading": _reading(alerts, kpis, tl, b["watch"]), "rules": [{"factor": r[2], "domain": r[1], "line": r[6], "source": r[7], "evidence": r[8],
                                                            "tiers": [f"{op} {thr:g} = {pri}" for op, thr, pri in r[5]]} for r in RULES] if alerts or tl else None,
           "thresholds": {"stale_days": STALE_DAYS, "persist_days": PERSIST_DAYS},
           "disclaimer": "Decision support only. Not a diagnosis. Lines are general-population references, not NASA flight-surgeon limits."}
    return _clean(out)
