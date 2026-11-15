"""Bone & Muscle AI advice, shown under the calculator.

The backend rebuilds a compact summary from the same numbers as the page (app/services/bone_muscle_insight_service.py:
the calculated profile against its targets, the drivers, the what-if levers, the model's reliability, plus the
astronaut's own exercise log and body-map reports), adds the bone system prompt and asks the same providers as the rest
of the app (Gemini first, Groq/Grok fallback). Nothing is typed in here: if no provider answers, the caller gets an error
block and shows that, never invented advice. The AI never changes the Good / Warning / Critical level.
"""
from sqlalchemy.orm import Session

from app.schemas.ml import BoneMuscleRequest
from app.services import bone_muscle_insight_service, llm_service

_DISC = "Demo only, not medical advice."


def _bone(b: dict) -> dict:
    rel = b["reliability"]
    pc = rel.get("per_class") or {}
    return {
        "probabilities": b["probabilities"], "medium_or_high": b["not_low"],
        "inputs": [{"input": r["label"], "value": r["value"] if r["entered"] else None, "unit": r["unit"], "target": r["target"], "status": r["status"],
                    "can_be_changed": r["modifiable"], "training_average": (r["training"] or {}).get("mean"), "push_on_risk": r["push"]} for r in b["table"]],
        "drivers_largest_first": [{"input": d["label"], "push": d["push"], "raises_risk": d["raises_risk"]} for d in b["drivers"]["items"][:5]],
        "share_of_push_that_cannot_change": b["drivers"]["fixed_share"],
        "what_if_one_change": [{"change": f'{l["label"]}: {l["change"]}', "high_risk_change_points": l["delta_high_points"], "medium_or_high_change_points": l["delta_not_low_points"]} for l in b["levers"]["items"]],
        "reliability": {"adults": rel.get("n"), "macro_auc": rel.get("macro_auc"), "high_answer_right_share": (pc.get("High") or {}).get("precision"),
                        "high_caught_share": (pc.get("High") or {}).get("recall"), "base_rates": rel.get("base_rates")},
        "inputs_not_entered_filled_with_training_median": [r["label"] for r in b["table"] if not r["entered"]],
    }


def _exercise(ex: dict) -> dict:
    s, a, r = ex["summary"], ex["adherence"], ex["rules"]
    return {"sessions": s["sessions"], "days_covered": s["days_in_span"], "active_days": s["active_days"], "longest_gap_days": s["longest_gap_days"],
            "last_7_days": {"minutes": s["last7"]["minutes"], "active_days": s["last7"]["active_days"], "strength_days": s["last7"]["strength_days"]},
            "minutes_by_type": {k: v["minutes"] for k, v in s["kinds"].items()},
            "references": {"ground_minimum_min_week": r["who_week_min"], "strength_days_week": r["strength_days_week"], "iss_routine_min_week": r["flight_week_min"]},
            "full_weeks": a["full_weeks"], "weeks_meeting_ground_minimum": a["weeks_meeting_who"], "weeks_meeting_strength": a["weeks_meeting_strength"]}


def _msk(m: dict) -> dict:
    return {"days": m["days"], "regions": [{"region": r["name"], "load_bearing": r["load_bearing"], "reports": r["count"], "latest_severity_of_10": r["latest_severity"],
                                              "max_severity_of_10": r["max_severity"], "trend": r["trend"]} for r in m["regions"]]}


def get_bone_advice(db: Session, req: BoneMuscleRequest) -> dict:
    data = bone_muscle_insight_service.get_bone_muscle_insight(db, req)
    bone = data.get("bone")
    if not (bone or {}).get("available"):
        return {"ai": {"source": "none", "model": None, "cached": False, "attempts": [], "result": None,
                       "error": "No bone profile to base advice on yet. Fill in the calculator and press Calculate."}, "disclaimer": _DISC}
    context: dict = {"bone_risk": _bone(bone), "profile_source": bone["source"]}
    if (data.get("exercise") or {}).get("available"):
        context["exercise_log"] = _exercise(data["exercise"])
    if data.get("today"):
        context["exercise_minutes_today"] = data["today"]["minutes"]
    if data.get("msk"):
        context["musculoskeletal_reports"] = _msk(data["msk"])
    context["data_source"] = "bone_risk_calculator_and_own_logs"
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.BONE_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [], "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": _DISC}
