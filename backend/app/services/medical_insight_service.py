"""Medical View deep dive (POST /api/v1/ml/medical-insight) and its AI brief (POST /api/v1/ml/medical-recommendations).

The existing Medical View lists every scenario in the crew file and the model register. This module adds a briefing for the
medical officer about ONE astronaut, built from the SAME factor alerts as the Risk Alerts page and the readiness view of the
Mission Profile page:

  patient     who, age, sex, BMI, mission day and phase, and the readiness verdict
  queue       the alerts in priority order: what was measured, the line, how long it lasted, the step to take
  trends      each logged measure, last days against the astronaut's OWN earlier days, marked worse / steady / better
  follow_up   when each alert and each close-to-the-line factor should be looked at again
  handover    a short SBAR note (situation, background, assessment, recommendation) the officer can copy
  blind_spots which data sources are missing, so the officer knows what this review cannot see

Nothing is typed in. The AI never changes a priority or the verdict.
"""
import numpy as np
from sqlalchemy.orm import Session

from app.schemas.ml import AlertsInsightRequest
from app.services import alerts_insight_service as ais
from app.services import llm_service
from app.services import mission_insight_service as ms
from app.services.vitals_insight_service import _clean

_DISC = "Decision support only. Not a diagnosis. Lines are general-population references, not NASA flight-surgeon limits."
PRI = ais.PRI
MD_PREFIX = "Tell the mission medical officer today. "


def _step(text):
    """The steps are written for the crew member; this page is read by the medical officer, so the hand-over phrase is dropped."""
    return text[len(MD_PREFIX):] if text.startswith(MD_PREFIX) else text

# key, label, unit, which direction is worse (+1 higher is worse, -1 lower is worse)
TREND_MEASURES = [
    ("hr", "Heart rate", "bpm", 1), ("spo2", "Blood oxygen (SpO2)", "%", -1), ("temp", "Body temperature", "C", 1),
    ("sys", "Systolic blood pressure", "mmHg", 1), ("dia", "Diastolic blood pressure", "mmHg", 1), ("sleep", "Sleep", "h", -1),
    ("fatigue", "Fatigue", "/10", 1), ("stress", "Stress", "/10", 1), ("mood", "Mood", "/10", -1),
    ("reaction", "Reaction time", "ms", 1), ("attention", "Attention score", "/100", -1),
]
MIN_DAYS = 6
WHEN = {"critical": ("Now, within hours", 0), "high": ("Within 24 hours", 1), "medium": ("Within 48 hours", 2), "low": ("At the next routine check", 3)}


def _trends(df):
    if df is None or df.empty:
        return None
    rows = []
    for key, label, unit, sign in TREND_MEASURES:
        if key not in df.columns:
            continue
        s = df[key].dropna()
        n = len(s)
        if n < MIN_DAYS:
            continue
        k = min(7, n // 2)
        recent, base = s.tail(k), s.head(n - k)
        bm = float(base.mean())
        if bm == 0:
            continue
        pct = (float(recent.mean()) - bm) / abs(bm) * 100
        sd = float(base.std(ddof=1)) if len(base) > 1 else 0.0
        z = sign * (float(recent.mean()) - bm) / sd if sd > 0 else 0.0   # positive = worse than the own earlier average
        status = "worse" if z >= 1 else "better" if z <= -1 else "steady"
        rows.append({"key": key, "label": label, "unit": unit, "recent": round(float(recent.mean()), 1), "earlier": round(bm, 1), "pct": round(pct, 1),
                     "z": round(float(z), 2), "status": status, "days_recent": int(k), "days_earlier": int(len(base))})
    rows.sort(key=lambda r: -abs(r["z"]))
    return rows or None


def _follow_up(alerts, watch):
    out = []
    for a in alerts:
        when, rank = WHEN[a["priority"]]
        out.append({"when": when, "rank": rank, "title": a["title"], "priority": a["priority"], "action": _step(a["action"]),
                    "who": "Medical officer" if a["priority"] in ("critical", "high") else "Crew member"})
    for w in watch[:4]:
        out.append({"when": "Re-measure in 48 hours", "rank": 2.5, "title": w["factor"], "priority": "watch", "action": f'{w["factor"]} is {w["distance_pct"]}% from its line. Re-measure under the same conditions.', "who": "Crew member"})
    out.sort(key=lambda r: r["rank"])
    return out[:12]


def _handover(g, trends):
    r, m, j, b, cov = g["readiness"], g["mission"], g["journey"], g["b"], g["cov"]
    alerts = b["alerts"]
    who = (m["name"] if m else None) or "Astronaut"
    bits = [who]
    if m and m["age"] is not None:
        bits.append(f'{m["age"]} y')
    if m and m["sex"]:
        bits.append(m["sex"].lower())
    s = ", ".join(bits) + "."
    if j:
        s += f' Mission day {j["day"]} of {j["planned_days"]} ({j["phase_label"]})' if 1 <= j["day"] <= j["planned_days"] else f' {j["headline"]}'
        s += "." if 1 <= j["day"] <= j["planned_days"] else "."
    s += f' Readiness: {r["label"]}. {r["alerts"]} alert(s) across {r["areas"]} area(s)' + (f', highest {r["highest"]}.' if r["highest"] else ".")
    miss = [c["label"] for c in cov if c["state"] == "missing"]
    bg = []
    if m and m["bmi"]:
        bg.append(f'BMI {m["bmi"]} ({m["bmi_class"]}).')
    if g["logs"]:
        bg.append(f'{g["logs"]["days_logged"]} of {g["logs"]["window_days"]} days logged, streak {g["logs"]["streak"]}.')
    if m and m["destination"]:
        bg.append(f'Destination {m["destination"]}.')
    bg.append(f'{sum(1 for c in cov if c["state"] == "ready")} of {len(cov)} data sources in use' + (f'; missing: {", ".join(miss)}.' if miss else "."))
    ass = []
    for a in alerts[:3]:
        t = a["title"]
        if a["kind"] != "compound" and a.get("observed") is not None:
            t += f' (measured {a["observed"]}{(" " + a["unit"]) if a["unit"] else ""}, line {a["line"]}' + (f', {a["run"]} readings in a row)' if (a["run"] or 0) > 1 else ")")
        ass.append(t + ".")
    worse = [f'{t["label"]} {t["pct"]:+.0f}% against own earlier days' for t in (trends or []) if t["status"] == "worse"][:3]
    rec = list(dict.fromkeys(_step(a["action"]) for a in alerts[:3]))
    rec.append("Contact the mission medical officer: " + ("yes." if r["contact_medical_officer"] else "not required by the rules."))
    return [{"k": "S", "label": "Situation", "text": s}, {"k": "B", "label": "Background", "text": " ".join(bg)},
            {"k": "A", "label": "Assessment", "text": " ".join(ass + ([("Worse than own baseline: " + "; ".join(worse) + ".")] if worse else [])) or "No alert is raised."},
            {"k": "R", "label": "Recommendation", "text": " ".join(rec)}]


def get_medical_insight(db: Session, req: AlertsInsightRequest) -> dict:
    g = ms._gather(db, req)
    b, r = g["b"], g["readiness"]
    trends = _trends(g["df"])
    alerts = b["alerts"]
    queue = [{"id": a["id"], "title": a["title"], "priority": a["priority"], "domain": ais.DOMAIN_NAME.get(a["domain"], a["domain"]), "factor": a["factor"], "observed": a["observed"],
              "unit": a["unit"], "line": a["line"], "run": a["run"], "since": a["since"], "kind": a["kind"], "evidence": a["evidence"], "action": _step(a["action"])} for a in alerts[:8]]
    n_worse = sum(1 for t in (trends or []) if t["status"] == "worse")
    cov = g["cov"]
    miss = [{"label": c["label"], "unlocks": c["unlocks"], "how": c["how"]} for c in cov if c["state"] == "missing"]
    out = {"selection": {"astronaut_id": req.astronaut_id, "days": req.days}, "readiness": r, "mission": g["mission"],
           "journey": {k: g["journey"][k] for k in ("day", "planned_days", "phase", "phase_label", "headline", "pct")} if g["journey"] else None,
           "kpis": {"alerts": r["alerts"], "highest": r["highest"], "watch": r["watch"], "worse": n_worse, "better": sum(1 for t in (trends or []) if t["status"] == "better"),
                    "coverage": f'{sum(1 for c in cov if c["state"] == "ready")} of {len(cov)}', "contact": r["contact_medical_officer"]},
           "queue": queue or None, "trends": trends, "follow_up": _follow_up(alerts, b["watch"]) or None, "handover": _handover(g, trends), "blind_spots": miss or None,
           "disclaimer": _DISC}
    return _clean(out)


def get_medical_advice(db: Session, req: AlertsInsightRequest) -> dict:
    g = ms._gather(db, req)
    b, r, m, j = g["b"], g["readiness"], g["mission"], g["journey"]
    trends = _trends(g["df"])
    context = {
        "readiness": {"verdict": r["label"], "alerts": r["alerts"], "areas_in_alert": r["areas"], "highest_priority": r["highest"], "close_to_a_line": r["watch"], "model_level": r["level"]},
        "astronaut": {"age": m["age"], "sex": m["sex"], "bmi": m["bmi"], "bmi_class": m["bmi_class"], "role": m["role"]} if m else None,
        "mission": {"destination": j["reference"]["name"] if j["reference"] else None, "mission_day": j["day"], "planned_days": j["planned_days"], "phase": j["phase_label"]} if j else None,
        "alerts": [{"id": a["id"], "domain": a["domain"], "factor": a["factor"], "title": a["title"], "priority": a["priority"], "measured": a["observed"], "unit": a["unit"], "line": a["line"],
                    "readings_in_a_row": a["run"], "since": a["since"], "kind": a["kind"], "evidence": a["evidence"]} for a in b["alerts"][:8]],
        "trends_against_own_earlier_days": [{"measure": t["label"], "recent": t["recent"], "earlier": t["earlier"], "unit": t["unit"], "percent_change": t["pct"], "status": t["status"]} for t in (trends or [])[:8]],
        "close_to_their_line_but_not_over": [{"factor": w["factor"], "value": w["value"], "unit": w["unit"], "line": w["line"], "percent_from_line": w["distance_pct"]} for w in b["watch"][:5]],
        "data_sources_missing": [c["label"] for c in g["cov"] if c["state"] == "missing"],
        "window_days": req.days, "data_source": "own_logs_selected_data_and_check_day_models",
    }
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.MEDICAL_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [], "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": _DISC}
