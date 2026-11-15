"""Radiation Monitor AI advice.

The frontend sends a compact summary of its reference exposure model; the backend adds the
radiation-specific system prompt and asks the same providers as the rest of the app (Gemini first,
Grok/Groq fallback). Nothing is hardcoded here: if no provider answers, the caller gets an error
block and shows that, never invented advice.
"""
from app.schemas.ml import RadiationRequest
from app.services import llm_service


def get_radiation_advice(req: RadiationRequest) -> dict:
    context = req.model_dump(exclude={"language"})
    context["data_source"] = (
        "reference_model_estimate_plus_crew_dosimeter" if req.measured_dose_msv is not None
        else "reference_model_estimate_not_measured"
    )
    try:
        ai = llm_service.generate(context, req.language, system_prompt=llm_service.RADIATION_SYSTEM_PROMPT)
    except llm_service.LLMUnavailable as exc:
        ai = {"source": "rules_only", "model": None, "cached": False, "attempts": [],
              "error": str(exc), "result": None}
    return {"ai": ai, "disclaimer": "Demo only, not medical advice."}
