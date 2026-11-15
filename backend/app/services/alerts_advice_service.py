"""AI recommendations for the Risk Alerts page.

The backend rebuilds the SAME alerts the page shows (app/services/alerts_insight_service.py), turns them into a compact
summary and asks the same providers as the rest of the app (Gemini first, Groq/Grok fallback). Nothing is typed in. If no
provider answers, the caller gets an error block and shows it, never invented advice. The AI never changes a priority or
the Good / Warning / Critical level; every alert already carries its own rule-based step.
"""
from sqlalchemy.orm import Session

from app.schemas.ml import AlertsInsightRequest
from app.services import alerts_insight_service as ais
from app.services import llm_service

_DISC = "Demo only, not medical advice."


def get_alerts_advice(db: Session, req: AlertsInsightRequest) -> dict:
    b = ais.build_alerts(db, req)
    alerts = b["alerts"]
    if not alerts:
        return {"ai": {"source": "none", "model": None, "cached": False, "attempts": [], "result": None,
                       "error": "No alert is raised, so there is nothing to give advice on."}, "disclaimer": _DISC}
    in_range = [ais.DOMAIN_NAME[d] for d in sorted(b["checked"]) if not any(a["domain"] == d for a in alerts)]
    context = {
        "alerts": [{"id": a["id"], "domain": a["domain"], "factor": a["factor"], "title": a["title"], "priority": a["priority"], "kind": a["kind"],
                    "measured": a["observed"], "unit": a["unit"], "line": a["line"], "readings_in_a_row": a["run"], "since": a["since"],
                    "raised_by_persistence": a["escalated"], "evidence": a["evidence"], "members": a.get("members")} for a in alerts],
        "factors_in_range": in_range,
        "close_to_their_line_but_not_over": [{"factor": w["factor"], "value": w["value"], "unit": w["unit"], "line": w["line"], "percent_from_line": w["distance_pct"]} for w in b["watch"][:6]],
        "not_current": [f'{s["factor"]} (last reading {s["days_ago"]} days ago)' for s in b["stale"]],
        "model_level": b["day_level"], "window_days": req.days, "data_source": "own_logs_and_check_day_models",
    }
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.ALERTS_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [], "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": _DISC}
