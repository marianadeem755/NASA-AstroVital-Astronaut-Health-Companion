"""Sleep Tracker AI advice.

The backend rebuilds a compact summary from the astronaut's own nights and the selected MMASH volunteer
(app/services/sleep_insight_service.py), adds the sleep system prompt and asks the same providers as the rest of the
app (Gemini first, Groq/Grok fallback). Nothing is typed in here: if no provider answers, the caller gets an error
block and shows that, never invented advice. No health value is taken from the browser.
"""
from sqlalchemy.orm import Session

from app.schemas.ml import SleepInsightRequest
from app.services import llm_service, sleep_insight_service


def _r(v, d=1):
    return None if v is None else round(float(v), d)


def _own_nights(log: dict) -> dict:
    s, d, reg = log["summary"], log["debt"], log["regularity"]
    out = {
        "guideline_hours": log["rules"]["target_hours"], "nights_logged": s["nights"], "window_days": log["window"]["days"],
        "days_since_latest_night": log["window"]["days_since_latest"],
        "mean_hours": s["mean"], "shortest_night_hours": s["min"], "longest_night_hours": s["max"], "spread_hours": s["sd"],
        "nights_below_guideline": s["nights_below_guideline"], "nights_inadequate_or_worse": s["nights_inadequate_or_worse"],
        "current_short_nights_in_a_row": s["current_short_run"], "longest_short_run": s["longest_short_run"],
        "last_night": {"hours": s["last_night"]["hours"], "band": s["last_night"]["band"],
                       "difference_from_own_usual_hours": (s["last_night"]["usual"] or {}).get("latest_difference")},
        "sleep_balance_hours": d["net_hours"], "short_hours_last_7_nights": d["short_hours_last7"], "full_nights_lost": d["nights_equivalent_lost"],
        "swing_between_nights_hours": reg["swing_hours"],
    }
    if reg.get("halves"):
        out["regularity_trend"] = {"first_half_spread_h": reg["halves"]["first_sd"], "second_half_spread_h": reg["halves"]["second_sd"], "direction": reg["halves"]["direction"]}
    if reg.get("rebound"):
        rb = reg["rebound"]
        out["catch_up"] = {"night_after_short_h": rb["after_short_mean"], "night_after_good_h": rb["after_ok_mean"], "catches_up": rb["catches_up"]}
    if log.get("rating"):
        q = log["rating"]["quadrants"]
        out["hours_vs_rating"] = {"correlation": log["rating"]["r"], "enough_hours_but_not_rested_nights": q["enough_not_rested"], "short_but_rested_nights": q["short_but_rested"], "nights_compared": log["rating"]["n"]}
    if log.get("cost"):
        out["days_after_short_night_vs_good_night"] = [{"measure": r["label"], "after_short": r["after_short"], "after_good": r["after_ok"], "unit": r["unit"],
                                                        "noticeable": r["noticeable"], "worse_after_short": r["worse_after_short"]} for r in log["cost"]["rows"]]
    return out


def _measured_night(lab: dict) -> dict:
    out = {"participant": lab["participant"], "cohort_size": lab["cohort_size"], "population": lab["population_note"],
           "measures": [{"measure": v["label"], "value": _r(v["value"], 2), "unit": v["unit"], "cohort_middle": _r(v["middle"], 2), "verdict": v["verdict"],
                         "past_reference_line": v["past_reference"], "reference": (v["reference"] or {}).get("text")} for v in lab["variables"]],
           "flags": [f["text"] for f in lab["profile"]["flags"]]}
    if lab.get("perception"):
        out["questionnaire_vs_sensor"] = {"verdict": lab["perception"]["verdict"], "text": lab["perception"]["text"]}
    dr = lab.get("drivers")
    if dr:
        out["model_drivers"] = {"poor_sleep_probability": _r(dr["probability"], 2), "roc_auc": _r(dr["roc_auc"], 2), "inputs_against_sleep_science": dr["against_expectation"], "inputs_judged": dr["judged"]}
    return out


def get_sleep_advice(db: Session, req: SleepInsightRequest) -> dict:
    data = sleep_insight_service.get_sleep_insight(db, req)
    context: dict = {}
    if (data.get("log") or {}).get("available"):
        context["own_nights"] = _own_nights(data["log"])
    if (data.get("lab") or {}).get("available"):
        context["measured_night"] = _measured_night(data["lab"])
    if not context:
        return {"ai": {"source": "none", "model": None, "cached": False, "attempts": [], "result": None,
                       "error": "No logged nights and no measured night to base advice on yet."}, "disclaimer": "Demo only, not medical advice."}
    context["data_source"] = "own_logged_nights_and_or_mmash_measured_night"
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.SLEEP_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [], "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": "Demo only, not medical advice."}
