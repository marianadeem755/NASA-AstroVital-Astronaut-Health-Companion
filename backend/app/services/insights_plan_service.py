"""Action plan for the Insights & Actions page (POST /api/v1/ml/insights-plan and /ml/insights-recommendations).

The page already shows what the AI says about the check-day model results. This module adds a plan built from the SAME
factor alerts as the Risk Alerts page (app/services/alerts_insight_service.py: the astronaut's logged data, body-map
reports, the selected MMASH / HRV / blood / bone data and the model flags), so the two pages always agree.

  plan       rule-based steps in three lists, always available: today, this week, ask the medical officer. Steps that
             several alerts share are merged, and each step says which alerts it answers.
  pressure   how much alert weight each area carries (low 1, medium 2, high 4, critical 8), to show where to start
  links      patterns between factors found by rules (short sleep with strain elsewhere, exercise gap with bone or
             muscle alerts, stress with low HRV, several vital signs at once). They are associations, not causes.
  questions  what to bring to the medical conference
  watch      factors close to their line but not over it

POST /ml/insights-recommendations asks the AI providers (Gemini first, Groq/Grok fallback) to turn the same facts into one
written plan. The AI never changes a priority or the Good / Warning / Critical level; if no provider answers the caller
gets an error block and shows it, never invented advice. Nothing here is a diagnosis.
"""
from sqlalchemy.orm import Session

from app.schemas.ml import AlertsInsightRequest
from app.services import alerts_insight_service as ais
from app.services import llm_service
from app.services.vitals_insight_service import _clean

PRI = ais.PRI
WEIGHT = {"low": 1, "medium": 2, "high": 4, "critical": 8}
MD_PREFIX = "Tell the mission medical officer today. "
MAX_PER_LIST = 8
_DISC = "Demo only, not medical advice."

SLEEP_IDS = {"sleep", "d_sleep", "d_eff", "d_waso", "d_psqi"}
STRAIN_IDS = {"fatigue", "stress", "mood", "reaction", "attention", "hr", "d_stress", "d_stai1", "d_stai2", "d_rmssd", "d_lowhrv", "model_stress", "model_hrv"}
EXERCISE_IDS = {"inactivity", "weekly_minutes", "model_exercise"}
STRESS_IDS = {"stress", "d_stress", "d_stai1", "d_stai2", "model_stress"}
HRV_IDS = {"d_rmssd", "d_lowhrv", "model_hrv"}
VITAL_IDS = {"hr", "spo2", "temp", "sys", "dia"}


def _step_text(a):
    t = a["action"]
    return t[len(MD_PREFIX):] if t.startswith(MD_PREFIX) else t


def _bucket(a):
    if a["kind"] == "compound":
        return "today"
    if a["priority"] in ("high", "critical", "medium"):
        return "today"
    return "this_week"


def _plan(alerts):
    lists = {"today": {}, "this_week": {}, "ask_medical_officer": []}
    for a in alerts:
        text = _step_text(a)
        b = lists[_bucket(a)]
        item = b.setdefault(text, {"action": text, "priority": a["priority"], "because": [], "domains": [], "evidence": a["evidence"], "alert_ids": []})
        if PRI.index(a["priority"]) > PRI.index(item["priority"]):
            item["priority"] = a["priority"]
        item["because"].append(a["title"])
        item["alert_ids"].append(a["id"])
        if a["domain"] not in item["domains"]:
            item["domains"].append(a["domain"])
        if a["priority"] in ("high", "critical") or (a["kind"] == "reading" and a["run"] >= ais.PERSIST_DAYS):
            lists["ask_medical_officer"].append({"action": f"Report: {a['title']}" + (f", lasting {a['run']} readings in a row" if a["kind"] == "reading" and a["run"] > 1 else ""),
                                                 "priority": a["priority"], "because": [a["message"]], "domains": [a["domain"]], "evidence": a["evidence"], "alert_ids": [a["id"]]})
    def finish(items):
        items = sorted(items, key=lambda i: (-PRI.index(i["priority"]), -len(i["because"])))[:MAX_PER_LIST]
        return items
    return {"today": finish(lists["today"].values()), "this_week": finish(lists["this_week"].values()), "ask_medical_officer": finish(lists["ask_medical_officer"])[:6]}


def _pressure(alerts):
    rows = {}
    for a in alerts:
        if a["domain"] == "compound":
            continue
        r = rows.setdefault(a["domain"], {"domain": a["domain"], "label": ais.DOMAIN_NAME[a["domain"]], "score": 0, "alerts": 0, "worst": "low", "top": None})
        r["score"] += WEIGHT[a["priority"]]
        r["alerts"] += 1
        if PRI.index(a["priority"]) >= PRI.index(r["worst"]):
            r["worst"], r["top"] = a["priority"], a["title"]
    total = sum(r["score"] for r in rows.values()) or 1
    out = sorted(rows.values(), key=lambda r: -r["score"])
    for r in out:
        r["share"] = round(r["score"] / total, 3)
    return out


def _links(alerts):
    live = {a["id"]: a for a in alerts if a["kind"] != "compound" and PRI.index(a["priority"]) >= 0}
    ids = set(live)
    out = []

    def names(sel):
        return ", ".join(live[i]["factor"] for i in sorted(sel))
    sleep, strain = ids & SLEEP_IDS, ids & STRAIN_IDS
    if sleep and strain:
        out.append({"id": "sleep_first", "title": "Sleep may be the place to start", "tone": "warn", "members": sorted(sleep | strain), "evidence": "convention",
                    "text": f"Sleep alerts ({names(sleep)}) sit next to strain alerts ({names(strain)}). Short or broken sleep commonly shows up as higher stress, slower reactions and low heart-rate variability, so fixing sleep first may ease the others. This is an association, not proof of cause."})
    ex, bone = ids & EXERCISE_IDS, {i for i in ids if i.startswith("msk_")} | (ids & {"bone_screen"})
    if ex and bone:
        out.append({"id": "exercise_bone", "title": "Exercise gap alongside bone or muscle alerts", "tone": "warn", "members": sorted(ex | bone), "evidence": "convention",
                    "text": f"Exercise alerts ({names(ex)}) appear with bone or muscle alerts ({names(bone)}). In flight the exercise routine, resistive work above all, is the main countermeasure against bone and muscle loss, so a gap matters more when these appear together."})
    st, hrv = ids & STRESS_IDS, ids & HRV_IDS
    if st and hrv:
        out.append({"id": "stress_hrv", "title": "Stress and low recovery together", "tone": "warn", "members": sorted(st | hrv), "evidence": "convention",
                    "text": f"Stress or anxiety alerts ({names(st)}) come with low heart-rate-variability alerts ({names(hrv)}). Both can reflect the same load; a lighter day and a good night's sleep help both."})
    vit = ids & VITAL_IDS
    if len(vit) >= 2:
        out.append({"id": "vitals_cluster", "title": "More than one vital sign is off", "tone": "bad" if any(PRI.index(live[i]["priority"]) >= 2 for i in vit) else "warn", "members": sorted(vit), "evidence": "guideline",
                    "text": f"{names(vit)} are all outside their lines. Re-measure at rest with a good sensor fit first; if two or more stay off, tell the medical officer rather than treating them one by one."})
    blood = ids & {"blood_shift", "model_blood"}
    if blood and (sleep or strain):
        out.append({"id": "blood_load", "title": "Blood change with sleep or strain alerts", "tone": "mute", "members": sorted(blood | sleep | strain), "evidence": "weak",
                    "text": "A blood shift against the astronaut's own pre-flight values appears alongside sleep or strain alerts. After landing some change is expected, so treat this as something to put in front of the medical officer, not as a finding on its own."})
    return out


def _headline(alerts, pressure, plan):
    n_md = len(plan["ask_medical_officer"])
    areas = len([p for p in pressure])
    top = pressure[0] if pressure else None
    return {"alerts": len(alerts), "areas": areas, "to_medical_officer": n_md, "start_with": top["label"] if top else None,
            "start_share": top["share"] if top else None}


def _watch(b):
    return [{"factor": w["factor"], "text": w["text"], "distance_pct": w["distance_pct"], "evidence": w["evidence"]} for w in b["watch"][:6]]


def get_insights_plan(db: Session, req: AlertsInsightRequest) -> dict:
    b = ais.build_alerts(db, req)
    alerts = b["alerts"]
    if not alerts and not b["watch"]:
        return _clean({"selection": {"astronaut_id": req.astronaut_id, "days": req.days}, "available": False})
    plan = _plan(alerts)
    pressure = _pressure(alerts)
    out = {"selection": {"astronaut_id": req.astronaut_id, "days": req.days}, "available": True, "headline": _headline(alerts, pressure, plan), "plan": plan, "pressure": pressure or None,
           "links": _links(alerts) or None, "watch": _watch(b) or None, "alert_titles": {a["id"]: a["title"] for a in alerts},
           "stale": b["stale"] or None, "disclaimer": "Decision support only. Not a diagnosis. Steps are general guidance, not NASA procedures."}
    return _clean(out)


def get_insights_advice(db: Session, req: AlertsInsightRequest) -> dict:
    b = ais.build_alerts(db, req)
    alerts = b["alerts"]
    if not alerts:
        return {"ai": {"source": "none", "model": None, "cached": False, "attempts": [], "result": None,
                       "error": "No alert is raised, so there is no plan to write."}, "disclaimer": _DISC}
    pressure, links = _pressure(alerts), _links(alerts)
    in_range = [ais.DOMAIN_NAME[d] for d in sorted(b["checked"]) if not any(a["domain"] == d for a in alerts)]
    context = {
        "alerts": [{"id": a["id"], "domain": a["domain"], "factor": a["factor"], "title": a["title"], "priority": a["priority"], "kind": a["kind"],
                    "measured": a["observed"], "unit": a["unit"], "line": a["line"], "readings_in_a_row": a["run"], "since": a["since"],
                    "raised_by_persistence": a["escalated"], "evidence": a["evidence"], "members": a.get("members")} for a in alerts],
        "pressure_by_area": [{"area": p["label"], "weight_share": p["share"], "alerts": p["alerts"], "worst": p["worst"]} for p in pressure],
        "links_between_factors": [{"title": l["title"], "alerts": l["members"], "note": l["text"]} for l in links],
        "close_to_their_line_but_not_over": [{"factor": w["factor"], "value": w["value"], "unit": w["unit"], "line": w["line"], "percent_from_line": w["distance_pct"]} for w in b["watch"][:6]],
        "factors_in_range": in_range,
        "not_current": [f'{s["factor"]} (last reading {s["days_ago"]} days ago)' for s in b["stale"]],
        "model_level": b["day_level"], "window_days": req.days, "data_source": "own_logs_selected_data_and_check_day_models",
    }
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.INSIGHTS_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [], "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": _DISC}
