"""Mission Profile deep dive (POST /api/v1/ml/mission-insight) and its AI brief (POST /api/v1/ml/mission-recommendations).

The page used to list the crew file, the data used and the backend status. This module adds a readiness view on top of the
SAME factor alerts the Risk Alerts page uses (app/services/alerts_insight_service.py):

  readiness   one verdict from the alerts: Ready / Fit with items to watch / Needs attention / Not ready
  coverage    which data sources feed this check (profile, logs, exercise, body map, MMASH, HRV, blood, bone profile, models),
              what each one unlocks and how to add the missing ones
  logs        how many days each measure was logged, the daily rhythm, streak and longest gap
  mission     the astronaut record: mission, age, BMI and its WHO class
  models      which saved models ran for this selection and which population each one was built on
  ai          which provider will answer and how many calls are left today (no keys)

Nothing is typed in. A block that cannot be computed is left out. The AI never changes a verdict or a priority.
"""
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.body_map import SymptomReport
from app.models.astronaut import Astronaut
from app.models.exercise import ExerciseSession
from app.models.mission import MissionProfile
from app.repositories import astronaut_repo
from app.schemas.ml import AlertsInsightRequest, MissionProfileSave
from app.services import alerts_insight_service as ais
from app.services import analytics_insight_service as an
from app.services import insights_plan_service as ips
from app.services import llm_service, ml_service
from app.services.vitals_insight_service import _clean

_DISC = "Decision support only. Not a diagnosis. Lines are general-population references, not NASA flight-surgeon limits."
PRI = ais.PRI

MEASURES = {"hr": "Heart rate", "spo2": "Blood oxygen (SpO2)", "temp": "Body temperature", "sys": "Systolic blood pressure", "dia": "Diastolic blood pressure",
            "sleep": "Sleep hours", "fatigue": "Fatigue", "stress": "Stress", "mood": "Mood", "reaction": "Reaction time", "attention": "Attention score",
            "exercise": "Exercise minutes"}


def _bmi_class(b):
    if b < 18.5:
        return "Underweight"
    if b < 25:
        return "Healthy range"
    if b < 30:
        return "Overweight"
    return "Obese"


def _mission_block(db, astronaut_id, first_log):
    a = astronaut_repo.get(db, astronaut_id)
    if a is None:
        return None
    age = None
    if a.date_of_birth:
        t = date.today()
        age = t.year - a.date_of_birth.year - ((t.month, t.day) < (a.date_of_birth.month, a.date_of_birth.day))
    bmi = round(a.weight_kg / ((a.height_cm / 100) ** 2), 1) if a.height_cm and a.weight_kg else None
    return {"name": a.full_name, "crew_code": a.crew_code, "mission": a.mission_name, "age": age, "sex": a.sex, "height_cm": a.height_cm,
            "weight_kg": a.weight_kg, "bmi": bmi, "bmi_class": _bmi_class(bmi) if bmi else None,
            "role": (jr.crew_role if (jr := _profile_row(db, astronaut_id)) else None), "crew_size": jr.crew_size if jr else None, "objective": jr.objective if jr else None,
            "destination": jr.destination if jr else None, "launch_date": jr.launch_date.isoformat() if jr and jr.launch_date else None,
            "planned_days": jr.planned_days if jr else None,
            "logging_since": first_log.isoformat() if first_log else None,
            "days_in_logs": (date.today() - first_log).days + 1 if first_log else None}


def _logs_block(df, days):
    if df is None or df.empty:
        return None
    idx = [d.date() for d in df.index]
    first, last = idx[0], idx[-1]
    have = set(idx)
    today = datetime.now(UTC).date()
    d, streak = today, 0
    if d not in have:
        d -= timedelta(days=1)
    while d in have:
        streak += 1
        d -= timedelta(days=1)
    per_measure = []
    for k, label in MEASURES.items():
        if k in df.columns:
            n = int(df[k].notna().sum())
            if n:
                per_measure.append({"key": k, "label": label, "days": n, "share": round(100 * n / max(len(df), 1))})
    per_measure.sort(key=lambda r: -r["days"])
    cols = [c for c in MEASURES if c in df.columns]
    rhythm = []
    start = today - timedelta(days=days - 1)
    d = start
    while d <= today:
        n = int(df.loc[df.index.date == d, cols].notna().sum(axis=1).iloc[0]) if d in have else 0
        rhythm.append({"day": d.isoformat(), "measures": n})
        d += timedelta(days=1)
    return {"days_logged": len(idx), "window_days": days, "first": first.isoformat(), "last": last.isoformat(),
            "days_since_last": (today - last).days, "streak": streak, "longest_gap": an._longest_gap(idx, first, last),
            "measures": len(per_measure), "per_measure": per_measure, "rhythm": rhythm,
            "coverage_pct": round(100 * len(idx) / days)}


def _readiness(b, alerts):
    pri = [a["priority"] for a in alerts]
    areas = len({a["domain"] for a in alerts if a["domain"] != "compound"})
    highest = max(pri, key=PRI.index) if pri else None
    long_high = any(a["priority"] == "high" and (a["run"] or 0) >= ais.PERSIST_DAYS for a in alerts)
    contact = highest == "critical" or long_high or areas >= ais.COMPOUND_MIN_DOMAINS
    has_data = bool(b["readings"]) or bool(alerts) or bool(b["checked"])
    if not has_data:
        state, label, tone = "unknown", "Not enough data to judge", "mute"
        text = "No reading has been checked yet. Add logs or pick data on the Daily Check-in page, then the verdict appears here."
    elif contact:
        state, label, tone = "not_ready", "Not ready: contact the medical officer", "bad"
        text = f"{len(alerts)} alert(s) across {areas} area(s), highest {highest}. Hold hard training until the medical officer has been spoken to."
    elif highest in ("high", "medium"):
        state, label, tone = "attention", "Needs attention", "warn"
        text = f"{len(alerts)} alert(s), highest {highest}. Work through the steps on the Risk Alerts and Insights pages today."
    elif alerts or b["watch"]:
        state, label, tone = "watch", "Fit, with items to watch", "ok"
        text = f"{len(alerts)} low alert(s) and {len(b['watch'])} factor(s) within 10% of a line. Nothing needs action today beyond the listed steps."
    else:
        state, label, tone = "ready", "Ready", "ok"
        text = "Every factor that was checked is inside its healthy line."
    return {"state": state, "label": label, "tone": tone, "text": text, "level": b["day_level"], "alerts": len(alerts), "areas": areas, "highest": highest,
            "watch": len(b["watch"]), "factors_checked": len(b["checked"]), "readings": len(b["readings"]), "contact_medical_officer": contact}


def _coverage(db, req, d, vals, logs, df, models_loaded):
    rows = []
    a = astronaut_repo.get(db, req.astronaut_id)

    def add(i, label, ok, detail, unlocks, how):
        rows.append({"id": i, "label": label, "state": "ready" if ok else "missing", "detail": detail, "unlocks": unlocks, "how": None if ok else how})

    add("profile", "Crew profile", bool(a and a.height_cm and a.weight_kg),
        f"{a.full_name} · {a.mission_name or 'mission not named'}" if a else "No crew record for this astronaut yet",
        "BMI and the bone-risk screening inputs", "Fill the Medical View profile (height, weight, birth date).")
    jr = _profile_row(db, req.astronaut_id)
    add("mission", "Mission details", bool(jr and jr.destination and jr.launch_date and jr.planned_days),
        f"{jr.destination} · {jr.planned_days} days from {jr.launch_date}" if jr and jr.destination and jr.launch_date and jr.planned_days else "Destination, launch date or duration not entered",
        "Mission day, phase, the phase focus and the destination reference", "Fill in the mission details on this page.")
    add("logs", "Daily logs", bool(logs), f"{logs['days_logged']} day(s) logged, last {logs['last']}" if logs else "Nothing logged in this window",
        "Per-factor alerts, persistence and the daily rhythm", "Log vitals, sleep and mood on the Vitals and Wellbeing pages.")
    ex_days = int(df["exercise"].notna().sum()) if df is not None and not df.empty and "exercise" in df.columns else 0
    ex_min = int(df["exercise"].tail(7).sum()) if ex_days else 0
    add("exercise", "Exercise log", ex_days > 0, f"{ex_days} session day(s), {ex_min} min in the newest 7 logged days" if ex_days else "No session logged",
        "Recovery alerts, the exercise-gap rule and bone/muscle context", "Log a session on the Bone & Muscle page.")
    n_msk = db.scalar(select(func.count(SymptomReport.id)).where(SymptomReport.astronaut_id == req.astronaut_id,
                                                                  SymptomReport.reported_at >= datetime.now(UTC) - timedelta(days=req.days))) or 0
    add("bodymap", "Body-map reports", n_msk > 0, f"{n_msk} report(s) in the last {req.days} days" if n_msk else "No report in this window",
        "Muscle and bone symptom alerts (recurring, load-bearing regions)", "Tap a region on the body map when something hurts.")
    sleep_ok = any(vals.get(k) is not None for k in ("sleep_h", "eff", "waso", "psqi", "stress"))
    add("mmash", "Sleep and stress data (MMASH)", sleep_ok, "A measured night and questionnaires are selected" if sleep_ok else "No MMASH volunteer selected",
        "Sleep efficiency, wake time, PSQI, STAI and daily stress score", "Choose an MMASH volunteer on the Daily Check-in page.")
    add("hrv", "Heart-rate variability", vals.get("rmssd") is not None, "HRV windows are selected" if vals.get("rmssd") is not None else "No HRV volunteer selected",
        "RMSSD and the share of low-HRV windows", "Choose an HRV volunteer on the Daily Check-in page.")
    add("blood", "Blood markers", bool(d and d.get("baseline_changes")), "Blood change against the own pre-flight average is available" if d and d.get("baseline_changes") else "No blood astronaut and timepoint selected",
        "Blood-shift alert and the post-flight model", "Choose a blood astronaut and timepoint on the Daily Check-in page.")
    add("bone", "Bone-risk screening", bool(d and d.get("bone_risk")), "A bone profile is saved" if d and d.get("bone_risk") else "No bone profile available",
        "Bone-risk class and what moves it", "Save a bone profile on the Bone & Muscle page.")
    add("models", "Saved models", len(models_loaded) > 0, f"{len(models_loaded)} of {len(ml_service.predict.MODEL_NAMES)} loaded",
        "Sleep, stress, HRV, blood and bone model scores", "Copy the model files into the backend models folder.")
    return rows


def _models(d, loaded):
    reg = ml_service.model_registry()
    scores = ((d or {}).get("check_day") or {}).get("scores") or {}
    ran = {ml_service.SCORE_TO_MODEL[k] for k, v in scores.items() if k in ml_service.SCORE_TO_MODEL and v is not None}
    if d and d.get("bone_risk"):
        ran.add(ml_service.BONE_MODEL)
    return [{"model": m["model"], "predicts": m["predicts"], "population": m["population"], "status": m["status"], "factors": m.get("factor_count"),
             "loaded": m["loaded"], "ran": m["model"] in ran} for m in reg]


def _providers():
    out = []
    for p in llm_service.status():
        left = None if p.get("daily_limit") in (None, 0) else max(int(p["daily_limit"]) - int(p["calls_today"] or 0), 0)
        out.append({"provider": p["provider"], "role": p["role"], "model": p["model"], "configured": p["configured"],
                    "calls_today": p["calls_today"], "daily_limit": p["daily_limit"], "left_today": left})
    return out


def _areas(readings):
    """Every checked factor grouped by area: over a line, close to it, or inside it (what the readiness verdict rests on)."""
    rows = {}
    for r in readings:
        row = rows.setdefault(r["domain"], {"domain": r["domain"], "label": ais.DOMAIN_NAME.get(r["domain"], r["domain"]), "over": 0, "near": 0, "ok": 0, "total": 0, "names": []})
        k = "ok" if r["status"] == "ok" else "near" if r["status"] == "watch" else "over"
        row[k] += 1
        row["total"] += 1
        if k == "over":
            row["names"].append(r["factor"])
    return sorted(rows.values(), key=lambda x: (-x["over"], -x["near"], -x["total"]))



# ---------------------------------------------------------------------------------------------
# the mission itself: where it goes, which phase today falls in, what that phase puts the weight on
# ---------------------------------------------------------------------------------------------
# What each phase puts the weight on, and the areas of the alert engine that watch it. These are design choices written here so the
# team can read and change them; they decide what is shown first, never a priority or the verdict.
PHASE_TEXT = {
    "before": ("Before launch", ["vitals", "sleep", "wellbeing", "cognition", "blood"],
               "Collect a clean own-baseline now. Cognition and blood are later judged against it, so log every day before launch."),
    "early": ("Early flight", ["sleep", "wellbeing", "vitals"],
              "The body is adjusting to the new environment. Sleep and mood shift first, so they are the first to watch and to log daily."),
    "mid": ("Mid mission", ["recovery", "musculoskeletal", "bone", "cognition", "blood"],
            "The long stretch. Bone, muscle and fitness change slowly, so the exercise routine, body-map reports and own-baseline trends matter most."),
    "return": ("Return window", ["vitals", "musculoskeletal", "recovery", "bone"],
               "Getting ready for landing. Vitals, strength and recovery should be steady and any open symptom should be followed up."),
    "after": ("After landing", ["blood", "bone", "musculoskeletal", "recovery"],
              "Re-adaptation. Blood, bone and muscle are compared with the own pre-flight values, and the exercise routine is rebuilt."),
}
DEST_REF = [
    (("ground", "simulat", "analog"), "Ground simulation", "Earth gravity (1 g)", "no delay", "Not a spaceflight exposure. The phase plan still applies, but bone and muscle loss from low gravity is not expected."),
    (("mars",), "Mars", "Mars surface 0.38 g, microgravity in transit", "3 to 22 minutes one way", "Beyond Earth's magnetic field, so crew radiation exposure is higher than in low Earth orbit. Transit is about 6 to 9 months each way."),
    (("moon", "lunar"), "Moon", "0.16 g on the surface (about one sixth of Earth), microgravity in transit", "about 1.3 seconds one way", "Beyond Earth's magnetic field, so crew radiation exposure is higher than in low Earth orbit."),
    (("orbit", "iss", "station", "leo"), "Low Earth orbit", "microgravity", "under 1 second", "Partly shielded by Earth's magnetic field, so radiation is lower than beyond it."),
]
LOW_G = ("mars", "moon", "lunar", "orbit", "iss", "station", "leo")


def _phases(p):
    edge = min(14, max(3, p // 6))
    early_end, ret_start = edge, p - edge + 1
    if ret_start <= early_end:   # a very short mission: no middle stretch
        ret_start = early_end + 1
    return [("early", 1, early_end), ("mid", early_end + 1, max(ret_start - 1, early_end + 1)), ("return", ret_start, max(p, ret_start))]


def _domain_state(dom, alerts, readings):
    mine = [a for a in alerts if a["domain"] == dom]
    if mine:
        return max((a["priority"] for a in mine), key=PRI.index)
    rs = [r for r in readings if r["domain"] == dom]
    if not rs:
        return "unchecked"
    return "near" if any(r["status"] == "watch" for r in rs) else "ok"


def _ref(dest):
    t = (dest or "").lower()
    for keys, name, gravity, comms, note in DEST_REF:
        if any(k in t for k in keys):
            return {"name": name, "gravity": gravity, "comms_delay": comms, "note": note, "low_gravity": any(k in t for k in LOW_G) and "ground" not in t and "simulat" not in t}
    return None


def _profile_row(db, astronaut_id):
    return db.scalar(select(MissionProfile).where(MissionProfile.astronaut_id == astronaut_id))


def _journey(db, astronaut_id, alerts, readings):
    row = _profile_row(db, astronaut_id)
    if row is None or not (row.launch_date and row.planned_days):
        return None
    today, p = date.today(), row.planned_days
    day = (today - row.launch_date).days + 1
    phases = [{"key": k, "label": PHASE_TEXT[k][0], "start": a, "end": b, "days": b - a + 1, "note": PHASE_TEXT[k][2], "focus": [ais.DOMAIN_NAME[d] for d in PHASE_TEXT[k][1]]} for k, a, b in _phases(p)]
    cur = "before" if day < 1 else "after" if day > p else next(x["key"] for x in phases if x["start"] <= day <= x["end"])
    label, focus, note = PHASE_TEXT[cur]
    ref = _ref(row.destination)
    focus_rows = [{"domain": dk, "area": ais.DOMAIN_NAME[dk], "state": _domain_state(dk, alerts, readings)} for dk in focus]
    if day < 1:
        headline = f"Launch in {1 - day} day(s)"
    elif day > p:
        headline = f"Landed {day - p} day(s) ago"
    else:
        headline = f"Mission day {day} of {p} · {p - day} day(s) to go"
    links = []
    if ref and ref["low_gravity"]:
        ex = _domain_state("recovery", alerts, readings)
        links.append({"title": "Lower gravity means less bone and muscle loading", "state": ex,
                      "text": f"At {ref['name']} the gravity is {ref['gravity']}. The exercise routine is the main counter-measure, and its area is currently {'over a line' if ex in PRI else 'close to a line' if ex == 'near' else 'inside its line' if ex == 'ok' else 'not checked'}.",
                      "area": ais.DOMAIN_NAME["recovery"]})
    return {"day": day, "planned_days": p, "launch_date": row.launch_date.isoformat(), "pct": max(0, min(100, round(100 * day / p))) if day > 0 else 0,
            "days_left": max(p - day, 0), "phase": cur, "phase_label": label, "phase_note": note, "headline": headline, "phases": phases,
            "focus": focus_rows, "reference": ref, "links": links}


def _profile_out(db, astronaut_id):
    a = astronaut_repo.get(db, astronaut_id)
    row = _profile_row(db, astronaut_id)
    return {"mission_name": a.mission_name if a else None, "destination": row.destination if row else None,
            "launch_date": row.launch_date.isoformat() if row and row.launch_date else None, "planned_days": row.planned_days if row else None,
            "crew_role": row.crew_role if row else None, "crew_size": row.crew_size if row else None, "objective": row.objective if row else None,
            "date_of_birth": a.date_of_birth.isoformat() if a and a.date_of_birth else None, "sex": a.sex if a else None,
            "height_cm": a.height_cm if a else None, "weight_kg": a.weight_kg if a else None, "full_name": a.full_name if a else None}


def save_mission_profile(db: Session, p: MissionProfileSave) -> dict:
    """Create the astronaut if the table is empty (the app can run on sample files), then store the mission and body details."""
    a = astronaut_repo.get(db, p.astronaut_id)
    if a is None:
        a = Astronaut(id=p.astronaut_id, crew_code=f"AST-{p.astronaut_id:03d}", full_name=f"Astronaut {p.astronaut_id}")
        db.add(a)
        db.flush()
    sent = p.model_fields_set
    for k in ("mission_name", "sex", "date_of_birth", "height_cm", "weight_kg"):
        if k in sent:
            v = getattr(p, k)
            setattr(a, k, (v.strip() or None) if isinstance(v, str) else v)
    row = _profile_row(db, p.astronaut_id)
    if row is None:
        row = MissionProfile(astronaut_id=p.astronaut_id)
        db.add(row)
    for k in ("destination", "launch_date", "planned_days", "crew_role", "crew_size", "objective"):
        if k in sent:
            v = getattr(p, k)
            setattr(row, k, (v.strip() or None) if isinstance(v, str) else v)
    db.commit()
    return {"saved": True, "profile": _profile_out(db, p.astronaut_id)}


def _gather(db: Session, req: AlertsInsightRequest) -> dict:
    b = ais.build_alerts(db, req)
    end = datetime.now(UTC)
    start = end - timedelta(days=req.days)
    has_astro = astronaut_repo.get(db, req.astronaut_id) is not None
    df = an._daily_frame(db, req.astronaut_id, start, end) if has_astro else None
    d, vals = None, {}
    try:
        d = ml_service.run_day(req)
        try:
            vals, _who = ais._selection_values(req, d)
        except Exception:   # noqa: BLE001 - no MMASH row or HRV windows selected
            vals = {}
    except Exception:   # noqa: BLE001 - nothing selected yet
        d = None
    logs = _logs_block(df, req.days)
    first_log = date.fromisoformat(logs["first"]) if logs else None
    from app.ml import predict
    loaded = sorted(predict.load_models().keys())
    cov = _coverage(db, req, d, vals, logs, df, loaded)
    journey = _journey(db, req.astronaut_id, b["alerts"], b["readings"]) if has_astro else None
    return {"journey": journey, "b": b, "d": d, "logs": logs, "cov": cov, "mission": _mission_block(db, req.astronaut_id, first_log) if has_astro else None,
            "models": _models(d, loaded), "readiness": _readiness(b, b["alerts"])}


def get_mission_insight(db: Session, req: AlertsInsightRequest) -> dict:
    g = _gather(db, req)
    cov, ready = g["cov"], g["readiness"]
    n_ready = sum(1 for c in cov if c["state"] == "ready")
    gaps = [c for c in cov if c["state"] == "missing"]
    top = [{"id": a["id"], "title": a["title"], "priority": a["priority"], "domain": ais.DOMAIN_NAME.get(a["domain"], a["domain"]), "action": a["action"]} for a in g["b"]["alerts"][:4]]
    out = {"selection": {"astronaut_id": req.astronaut_id, "days": req.days}, "readiness": ready,
           "coverage": {"items": cov, "ready": n_ready, "total": len(cov), "pct": round(100 * n_ready / len(cov))},
           "complete_the_picture": [{"label": c["label"], "unlocks": c["unlocks"], "how": c["how"]} for c in gaps[:5]] or None,
           "top_alerts": top or None, "watch": [{"factor": w["factor"], "text": w["text"], "distance_pct": w["distance_pct"]} for w in g["b"]["watch"][:4]] or None,
           "journey": g["journey"], "profile": _profile_out(db, req.astronaut_id),
           "areas": _areas(g["b"]["readings"]) or None, "pressure": ips._pressure(g["b"]["alerts"]) or None,
           "mission": g["mission"], "logs": g["logs"], "models": g["models"], "providers": _providers(), "disclaimer": _DISC}
    return _clean(out)


def get_mission_advice(db: Session, req: AlertsInsightRequest) -> dict:
    g = _gather(db, req)
    ready, cov = g["readiness"], g["cov"]
    b, logs, m = g["b"], g["logs"], g["mission"]
    context = {
        "readiness": {"verdict": ready["label"], "alerts": ready["alerts"], "areas_in_alert": ready["areas"], "highest_priority": ready["highest"],
                      "close_to_a_line": ready["watch"], "factors_checked": ready["factors_checked"], "model_level": ready["level"]},
        "mission": ({"destination": g["journey"]["reference"]["name"] if g["journey"]["reference"] else None, "mission_day": g["journey"]["day"],
                     "planned_days": g["journey"]["planned_days"], "phase": g["journey"]["phase_label"], "days_to_go": g["journey"]["days_left"],
                     "phase_puts_weight_on": [f'{x["area"]} (now {x["state"]})' for x in g["journey"]["focus"]],
                     "environment_reference_not_measured": g["journey"]["reference"]} if g["journey"] else None),
        "astronaut": {"crew_code": m["crew_code"], "mission": m["mission"], "bmi": m["bmi"], "bmi_class": m["bmi_class"], "age": m["age"], "role": m["role"], "crew_size": m["crew_size"], "objective": m["objective"], "days_in_logs": m["days_in_logs"]} if m else None,
        "data_sources": [{"source": c["label"], "state": c["state"], "detail": c["detail"], "unlocks": c["unlocks"]} for c in cov],
        "logging": {"days_logged": logs["days_logged"], "window_days": logs["window_days"], "streak_days": logs["streak"], "longest_gap_days": logs["longest_gap"],
                    "days_since_last_log": logs["days_since_last"], "measures_logged": [f'{r["label"]} ({r["days"]} days)' for r in logs["per_measure"][:8]]} if logs else None,
        "alerts": [{"id": a["id"], "domain": a["domain"], "factor": a["factor"], "title": a["title"], "priority": a["priority"], "measured": a["observed"], "unit": a["unit"],
                    "line": a["line"], "readings_in_a_row": a["run"], "evidence": a["evidence"]} for a in b["alerts"][:8]],
        "close_to_their_line_but_not_over": [{"factor": w["factor"], "value": w["value"], "unit": w["unit"], "line": w["line"], "percent_from_line": w["distance_pct"]} for w in b["watch"][:5]],
        "models_that_ran": [x["model"] for x in g["models"] if x["ran"]], "models_not_run": [x["model"] for x in g["models"] if not x["ran"]],
        "window_days": req.days, "data_source": "own_logs_selected_data_and_check_day_models",
    }
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.MISSION_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [], "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": _DISC}
