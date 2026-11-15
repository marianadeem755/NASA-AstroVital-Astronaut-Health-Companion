"""Mental Wellbeing AI advice.

The backend rebuilds a compact summary from the astronaut's own check-ins (app/wellbeing/insight_service)
and the selected MMASH volunteer (wellbeing_insight_service), adds the wellbeing system prompt and asks the
same providers as the rest of the app (Gemini first, Groq/Grok fallback). Nothing is typed in here: if no
provider answers, the caller gets an error block and shows that, never invented advice.
"""
from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.schemas.ml import DayRequest, WellbeingAdviceRequest
from app.services import llm_service, wellbeing_insight_service
from app.wellbeing import insight_service


def _r(v, d=1):
    return None if v is None else round(float(v), d)


def _self_context(d: dict) -> dict:
    metrics = []
    for m in d["metrics"]:
        u = m.get("usual") or {}
        metrics.append({
            "scale": m["label"], "higher_is_better": m["higher_is_better"], "latest": m["latest"], "mean": _r(m["mean"]),
            "check_ins": m["count"], "direction": m["direction"],
            "first_half_mean": _r(m["first_half_mean"]), "second_half_mean": _r(m["second_half_mean"]),
            "usual_range": [_r(u["low"]), _r(u["high"])] if u else None,
            "latest_is_worse_than_usual": u.get("latest_is_worse") if u else None,
            "concern_line": m.get("concern_line"), "check_ins_past_concern_line": m.get("days_past_line"),
        })
    c = d["concerns"]
    out = {
        "window_days": d["window"]["days"], "check_ins": d["checkins"], "days_with_check_ins": d["days_with_checkins"],
        "days_since_latest_check_in": d["window"]["days_since_latest"], "scale_0_to_10": True, "metrics": metrics,
        "concerns": {
            "check_ins_at_medium_or_high": c["flagged_checkins"], "share": _r(c["flagged_share"], 2),
            "current_run": c["current_run"], "longest_run": (c["longest_run"] or {}).get("checkins", 0),
            "days_since_last_concern": c["days_since_last_concern"], "latest_level": c["latest_level"],
            "most_common": [{"message": x["message"], "count": x["count"]} for x in (c.get("most_common") or [])[:3]],
        },
    }
    if d.get("pattern"):
        p = d["pattern"]
        out["pattern"] = {"verdict": p["verdict"], "title": p["title"], "worsening": p["worsening"],
                          "improving": p["improving"], "cognitive_deviations": p["cognitive_deviations"]}
    if d.get("links"):
        out["links"] = [{"a": x["a_label"], "b": x["b_label"], "r": _r(x["r"], 2), "strength": x["strength"]}
                        for x in d["links"]["pairs"][:4]]
        nd = d["links"].get("next_day")
        if nd:
            out["next_day_after_poorer_night"] = [{"scale": r["label"], "difference": _r(r["difference"])} for r in nd["rows"]]
    if d.get("cognitive"):
        out["cognitive"] = [{"test": m["label"], "unit": m["unit"], "latest": _r(m["latest"]), "baseline": _r(m["baseline_mean"]),
                             "recent": _r(m["recent_mean"]), "change_percent": _r(m["change_percent"], 0), "off_baseline": m["deviates"]}
                            for m in d["cognitive"]["metrics"] if m["count"]]
    if d.get("journal"):
        out["journal_notes_in_window"] = d["journal"]["total_with_notes"]  # note text is never sent to the AI
    return out


def _mind_context(mind: dict) -> dict:
    vs = []
    for v in mind["variables"]:
        if v["group"] != "mind":
            continue
        vs.append({"measure": v["label"], "value": _r(v["value"], 2), "cohort_middle": _r(v["middle"], 2), "verdict": v["verdict"],
                   "higher_is_better": v["higher_is_better"], "past_reference_line": bool(v.get("past_reference")),
                   "reference": (v.get("reference") or {}).get("text")})
    out = {"participant": mind["participant"], "cohort_size": mind["cohort_size"], "population": mind["population_note"], "scores": vs}
    mc = mind.get("model_check")
    if mc:
        mcx = {}
        if mc.get("stress"):
            s = mc["stress"]
            mcx["stress"] = {"reported": _r(s["reported"]), "model_said": _r(s["predicted"], 0), "typical_miss": _r(s["typical_miss"]),
                             "r2": _r(s["r2"], 2), "within_typical_miss": s.get("within_typical_miss")}
        if mc.get("sleep"):
            sl = mc["sleep"]
            mcx["sleep"] = {"reported_psqi": _r(sl["reported_psqi"], 0), "reported_poor": sl["reported_poor"],
                            "model_agrees": sl["agrees"], "roc_auc": _r(sl["roc_auc"], 2)}
        out["model_check"] = mcx
    return out


def get_wellbeing_advice(db: Session, req: WellbeingAdviceRequest) -> dict:
    context: dict = {}
    try:
        data = insight_service.get_wellbeing_insight(db, req.astronaut_id, req.days)
        if data.get("available"):
            context["self_report"] = _self_context(data)
    except AppError:
        pass  # unknown astronaut: advice can still come from the questionnaire side
    try:
        mind = wellbeing_insight_service.get_wellbeing_insight(
            DayRequest(scenario_id=req.scenario_id, subject_id=req.subject_id, mmash_user=req.mmash_user))["mind"]
        if mind.get("available"):
            context["questionnaire"] = _mind_context(mind)
    except Exception:  # noqa: BLE001 - questionnaire data is optional for this advice
        pass
    if not context:
        return {"ai": {"source": "none", "model": None, "cached": False, "attempts": [], "result": None,
                       "error": "No check-ins and no questionnaire data to base advice on yet."},
                "disclaimer": "Demo only, not medical advice."}
    context["data_source"] = "own_check_ins_and_or_mmash_questionnaire_volunteer"
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.WELLBEING_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [], "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": "Demo only, not medical advice."}
