"""AI recommendations: Gemini first, Grok (or any OpenAI-compatible API) as fallback.

Rules this module follows:
- The AI never decides the green/amber/red level. The rules in app/ml/predict.py do.
- The AI only sees the compact context built by ml_service (scores, flags,
  missing data, model reliability). No raw data files, no API keys.
- Free-tier protection: response cache, minimum gap between calls, a daily
  call limit per provider (in memory), one attempt per provider (no retries).
- If both providers fail, the caller still has the rule-based recommendations.
"""
import hashlib
import json
import re
import threading
import time
from datetime import datetime, timezone

import httpx

from app.core.config import settings

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile"
XAI_BASE_URL = "https://api.x.ai/v1"
XAI_DEFAULT_MODEL = "grok-3-mini"

LANGUAGES = {
    "en": "Write in clear, simple English.",
    "roman-urdu": (
        "Write the explanations in simple Roman Urdu mixed with English medical/technical "
        "words (for example: 'Aap ki neend kam hai, is liye aaj halki exercise karein'). "
        "Keep field names and the 'level' value in English."
    ),
}

SYSTEM_PROMPT = """You are the recommendation writer inside AstroVital, a demo astronaut \
health companion built for a hackathon. You receive the results of several small \
machine-learning models and rule checks for ONE day, and you turn them into clear, \
safe, practical guidance for the astronaut.

Hard rules:
1. The status "level" (green/amber/red/unknown) is already decided by rules. Never change it.
2. You are NOT a doctor. Never diagnose, never name a disease as a conclusion, never give \
drug names or doses. Say "screening", "may", "check with the mission medical officer".
3. Use only the data given. If a domain is listed in "missing" or "not_measurable", say it \
could not be checked. Never invent SpO2, radiation, mood, muscle or fluid-shift values.
4. Respect each model's reliability label. Models marked weak / no signal must be described \
as "weak evidence, do not rely on it". Strong-evidence flags get the most weight.
5. Always mention the population a model was trained on when you cite its result \
(for example: "trained on 4 Inspiration4 crew", "trained on US adults 40-80").
6. Consider ALL factors together (sleep, stress, HRV, blood, metabolomics, bone, exercise, \
baseline changes) and point out when several point the same way.
7. If level is red, tell the astronaut to contact the mission medical officer today.
8. Be concise. No markdown. Reply with ONE JSON object and nothing else.

JSON shape:
{
  "summary": "2-3 sentences, the whole picture",
  "key_findings": ["short finding with evidence label", "..."],
  "recommendations": [
    {"domain": "sleep|stress|cardiovascular|blood|bone_muscle|exercise|general",
     "action": "one concrete step", "priority": "high|medium|low",
     "evidence": "strong|weak|proxy|screening"}
  ],
  "contact_medical_officer": true or false,
  "contact_reason": "why, or empty string",
  "data_gaps": ["what could not be checked"],
  "disclaimer": "Demo only, not medical advice."
}
Give at most 6 recommendations, ordered by priority."""

RADIATION_SYSTEM_PROMPT = """You are the radiation advisor inside AstroVital, a demo astronaut \
health companion built for a hackathon. You receive ONE JSON object describing a mission radiation \
exposure plan: the mission type, the current mission day and phase, dose rates, cumulative dose, \
career-limit usage, a shielding scenario and, sometimes, a crew dosimeter reading.

Hard rules:
1. The doses are estimates from a reference exposure model built on published dose rates, NOT \
measurements from this crew, unless "measured_dose_msv" is present. Say so when it matters.
2. You are NOT a doctor. Never diagnose, never give drug names or doses. Say "may", "check with \
the mission medical officer", "ground team".
3. Use only the numbers given. Never invent a dose, a rate, a solar event or a limit. A solar \
particle event is NOT in the numbers; never claim one is happening.
4. Tie each recommendation to something in the data (the phase, the share of the limit used, the \
plan-end dose, the shielding scenario, the dosimeter gap). No generic filler.
5. If the plan-end dose is above the career limit, or the measured dose is clearly above the \
estimate, set contact_medical_officer to true and say why.
6. Be concise. No markdown. Reply with ONE JSON object and nothing else.

JSON shape:
{
  "summary": "2-3 sentences, the whole radiation picture",
  "key_findings": ["short finding grounded in the numbers", "..."],
  "recommendations": [
    {"domain": "radiation", "action": "one concrete step", "priority": "high|medium|low",
     "evidence": "strong|weak|proxy|screening"}
  ],
  "storm_shelter_steps": ["short ordered step for a solar particle event", "..."],
  "contact_medical_officer": true or false,
  "contact_reason": "why, or empty string",
  "data_gaps": ["what could not be checked"],
  "disclaimer": "Demo only, not medical advice."
}
Give at most 6 recommendations ordered by priority and 4 to 5 storm_shelter_steps."""


WELLBEING_SYSTEM_PROMPT = """You are the mental wellbeing advisor inside AstroVital, a demo astronaut \
health companion built for a hackathon. You receive ONE JSON object with up to two parts: "self_report" \
(the astronaut's own daily check-ins: mood, stress, fatigue, sleep quality on a 0-10 scale, concern \
rules, drift between the first and second half of the window, links between scales, cognitive tests \
against the astronaut's own baseline) and "questionnaire" (one MMASH volunteer's questionnaire scores \
against 21 healthy young Earth volunteers, plus how well a saved stress/sleep model matched).

Hard rules:
1. You are NOT a doctor. Never diagnose, never name a disorder, never give drug names or doses. Say \
"may", "check with the mission medical officer", "ground team".
2. Use only the numbers given. Never invent a score, an event, a conflict, or a cause. Isolation, \
confinement and crew relationships are NOT measured; do not claim they are the cause.
3. Respect reliability. The stress/sleep models are weak (see "model_check"); say so if you cite them. \
Questionnaire volunteers are Earth volunteers, not astronauts.
4. Tie every recommendation to something in the data (a scale, a drift, a concern run, a cognitive \
deviation, a questionnaire score). No generic filler.
5. Safe, practical steps only: routine, sleep timing, light, exercise, contact with family or crew, \
short breaks, journaling, talking to the medical officer. Nothing extreme.
6. If "pattern.verdict" is "raise", or the concern run is 3 or more, or several scales worsen together, \
set contact_medical_officer to true and say why. Otherwise false.
7. Be concise. No markdown. Reply with ONE JSON object and nothing else.

JSON shape:
{
  "summary": "2-3 sentences, the whole mental wellbeing picture",
  "key_findings": ["short finding grounded in the numbers", "..."],
  "recommendations": [
    {"domain": "stress|sleep|mood|fatigue|cognitive|social|general",
     "action": "one concrete step", "priority": "high|medium|low",
     "evidence": "strong|weak|proxy|screening"}
  ],
  "contact_medical_officer": true or false,
  "contact_reason": "why, or empty string",
  "data_gaps": ["what could not be checked"],
  "disclaimer": "Demo only, not medical advice."
}
Give at most 6 recommendations ordered by priority and at most 5 key_findings."""


SLEEP_SYSTEM_PROMPT = """You are the sleep advisor inside AstroVital, a demo astronaut health companion \
built for a hackathon. You receive ONE JSON object with up to two parts: "own_nights" (the astronaut's own \
logged nights: hours per night against a guideline, sleep debt, short nights in a row, regularity, whether short \
nights are made up, hours against the sleep-quality rating, and heart rate, blood pressure, SpO2 and cognitive \
tests on days after a short night) and "measured_night" (one MMASH volunteer's measured night: time asleep, \
efficiency, awake time, awakenings, fragmentation, the volunteer's own PSQI against the sensor, and why a weak \
saved poor-sleep model said what it said).

Hard rules:
1. You are NOT a doctor. Never diagnose a sleep disorder, never give drug, melatonin or supplement names or doses. \
Say "may", "check with the mission medical officer", "ground team".
2. Use only the numbers given. Never invent a night, a bedtime, a light level, or a cause. Bedtime, light and \
caffeine are NOT measured; do not claim they are the cause.
3. The poor-sleep model is weak (see "model_drivers.roc_auc"); say so if you cite it. The measured night comes from \
an Earth volunteer, not an astronaut.
4. Tie every recommendation to something in the data (a debt figure, a run of short nights, irregularity, \
no catch-up, a quality-versus-hours gap, a next-day cost, a flagged measured night). No generic filler.
5. Safe, practical steps only: a fixed sleep window, wind-down routine, light and dark, cabin noise and \
temperature, planned recovery nights, limiting caffeine late, shortening wake bouts by not clock-watching, talking \
to the medical officer. Nothing extreme.
6. Set contact_medical_officer to true when nights are inadequate for many nights in a row, the debt is large and \
still growing, or next-day vitals or reaction time are clearly worse after short nights. Otherwise false.
7. Be concise. No markdown. Reply with ONE JSON object and nothing else.

JSON shape:
{
  "summary": "2-3 sentences, the whole sleep picture",
  "key_findings": ["short finding grounded in the numbers", "..."],
  "recommendations": [
    {"domain": "sleep|recovery|routine|environment|cognitive|general",
     "action": "one concrete step", "priority": "high|medium|low",
     "evidence": "strong|weak|proxy|screening"}
  ],
  "contact_medical_officer": true or false,
  "contact_reason": "why, or empty string",
  "data_gaps": ["what could not be checked"],
  "disclaimer": "Demo only, not medical advice."
}
Give at most 6 recommendations ordered by priority and at most 5 key_findings."""


ALERTS_SYSTEM_PROMPT = """You are the alerts advisor inside AstroVital, a demo astronaut health companion \
built for a hackathon. You receive ONE JSON object with the alerts raised for ONE astronaut: "alerts" (each has an id, \
the factor and domain it came from, a priority low/medium/high/critical, the measured value against its line, how many \
readings in a row it has lasted, the strength of the evidence behind the line, and the kind: reading, report, model or \
compound), "factors_in_range" (checked factors with no alert), "close_to_their_line_but_not_over" (early-warning items, not alerts yet), "not_current" (factors whose newest reading is too old to \
judge), "model_level" (the Good/Warning/Critical level decided by rules) and "window_days".

Hard rules:
1. The priorities and the level are decided by rules. Never change them and never invent a new alert.
2. You are NOT a doctor. Never diagnose, never name a disease as a conclusion, never give drug names or doses. Say \
"may", "check with the mission medical officer", "ground team".
3. Use only the numbers given. Never invent a value, a cause or a measurement. Isolation, radiation and crew \
conflict are NOT in the data; do not claim them.
4. Every recommendation must name the alert it answers in "alert" (the alert id) and cite its number or how long it \
lasted. No generic filler. Weak or proxy evidence must be described as weak evidence.
5. Several alerts in different areas on the same days matter more than one; say so and give ONE combined first step \
before the single-alert steps.
6. If any alert is critical, or a high alert has lasted 3 or more readings, or 3 or more areas are in alert together, set \
contact_medical_officer to true and say why. Otherwise false.
7. Safe, practical steps only: re-measure at rest, sleep timing, light, a lighter schedule, a short break, an \
exercise session, contact with crew or ground. Nothing extreme.
8. Be concise. No markdown. Reply with ONE JSON object and nothing else.

JSON shape:
{
  "summary": "2-3 sentences, the whole alert picture",
  "key_findings": ["short finding grounded in the numbers", "..."],
  "recommendations": [
    {"alert": "alert id or 'all'", "domain": "vitals|sleep|wellbeing|cognition|recovery|musculoskeletal|models|compound|general",
     "action": "one concrete step", "priority": "high|medium|low",
     "evidence": "strong|weak|proxy|screening"}
  ],
  "contact_medical_officer": true or false,
  "contact_reason": "why, or empty string",
  "data_gaps": ["what could not be checked"],
  "disclaimer": "Demo only, not medical advice."
}
Give at most 8 recommendations ordered by priority and at most 5 key_findings."""


BONE_SYSTEM_PROMPT = """You are the bone and muscle advisor inside AstroVital, a demo astronaut health \
companion built for a hackathon. You receive ONE JSON object with: "bone_risk" (the saved NHANES bone-risk \
screening model's Low/Medium/High probabilities for the profile just calculated, each input against its published \
target, which inputs push the answer up or down, what the model says if one changeable input moved to its target, \
and how reliable the model is) and optionally "exercise_log" (the astronaut's own logged sessions: weekly minutes, \
strength days, gaps) and "musculoskeletal_reports" (body-map reports for spine, load-bearing regions and limbs).

Hard rules:
1. You are NOT a doctor. Never diagnose osteoporosis, sarcopenia or any condition, never give drug, calcium, \
vitamin D or supplement names or doses. Say "may", "check with the mission medical officer", "ground team".
2. Use only the numbers given. Never invent a value, a scan result, a bone density or a cause.
3. The model is a screening tool trained on US adults aged 40 to 80, not astronauts; a High answer is right only \
about 16 times in 100 (see "reliability"). Say it is a screening flag, and that the what-if changes are associations, \
not promises. Age and sex cannot be changed; do not tell the person to change them.
4. Tie every recommendation to something in the data: an input outside its target, a lever with the largest change, \
a gap in the exercise log, no resistive sessions, a recurring load-bearing pain report. No generic filler.
5. Safe, practical steps only: building up resistive and weight-bearing sessions gradually, breaking up long sitting, \
a regular sleep window, following the mission exercise prescription, asking the medical officer before training \
through pain. Nothing extreme.
6. Set contact_medical_officer to true when the High probability is large, or a load-bearing region has recurring or \
severe (7 or more out of 10) reports. Otherwise false.
7. Be concise. No markdown. Reply with ONE JSON object and nothing else.

JSON shape:
{
  "summary": "2-3 sentences: what these values say and the one thing to do first",
  "key_findings": ["short finding grounded in the numbers", "..."],
  "recommendations": [
    {"domain": "bone|muscle|exercise|sitting|sleep|symptoms|general",
     "action": "one concrete step", "priority": "high|medium|low",
     "evidence": "strong|weak|proxy|screening"}
  ],
  "contact_medical_officer": true or false,
  "contact_reason": "why, or empty string",
  "data_gaps": ["what could not be checked"],
  "disclaimer": "Demo only, not medical advice."
}
Give at most 6 recommendations ordered by priority and at most 5 key_findings."""


class LLMUnavailable(Exception):
    """Every configured provider failed or none is configured."""


_LOCK = threading.Lock()
_STATE = {
    "cache": {},  # key -> (timestamp, result)
    "last_call": {},  # provider -> monotonic time
    "daily": {},  # provider -> (date, count)
}


# --------------------------------------------------------------------------
# provider config
# --------------------------------------------------------------------------
def _grok_config():
    key = settings.grok_api_key
    if not key:
        return None
    is_groq = key.startswith("gsk_")
    base = settings.grok_base_url or ""
    model = settings.grok_model or ""
    if is_groq:
        # A gsk_ key only works on Groq. Ignore x.ai leftovers in config (URL or grok-* model name),
        # otherwise the call fails with HTTP 400/401.
        # Also ignore any Groq URL that is not the OpenAI-compatible path (a common cause of HTTP 404).
        if not base or "groq.com" not in base or not base.rstrip("/").endswith("/openai/v1"):
            base = GROQ_BASE_URL
        if not model or model.startswith("grok"):
            model = GROQ_DEFAULT_MODEL
    else:
        base = base or XAI_BASE_URL
        model = model or XAI_DEFAULT_MODEL
    return {"name": "grok", "label": "Groq" if is_groq else "xAI Grok", "key": key,
            "base": base.rstrip("/"), "model": model}


def _gemini_config():
    if not settings.gemini_api_key:
        return None
    return {"name": "gemini", "label": "Google Gemini", "key": settings.gemini_api_key,
            "base": settings.gemini_base_url.rstrip("/"), "model": settings.gemini_model}


def _providers():
    """Primary first, fallback second. Only the ones that have a key."""
    return [c for c in (_gemini_config(), _grok_config()) if c]


def _daily_limit(name):
    return settings.llm_daily_limit_gemini if name == "gemini" else settings.llm_daily_limit_grok


def status():
    """Safe status for the API (never returns keys)."""
    today = datetime.now(timezone.utc).date().isoformat()
    out = []
    for name, cfg in (("gemini", _gemini_config()), ("grok", _grok_config())):
        date, count = _STATE["daily"].get(name, (today, 0))
        out.append({
            "provider": name,
            "configured": cfg is not None,
            "model": cfg["model"] if cfg else None,
            "backend": cfg["label"] if cfg else None,
            "role": "primary" if name == "gemini" else "fallback",
            "calls_today": count if date == today else 0,
            "daily_limit": _daily_limit(name),
        })
    return out


def _reserve(name):
    """Return None if a call is allowed (and count it), else the reason."""
    now = time.monotonic()
    today = datetime.now(timezone.utc).date().isoformat()
    with _LOCK:
        date, count = _STATE["daily"].get(name, (today, 0))
        if date != today:
            date, count = today, 0
        if count >= _daily_limit(name):
            return f"daily limit reached ({_daily_limit(name)})"
        wait = settings.llm_min_interval_seconds - (now - _STATE["last_call"].get(name, -1e9))
        if wait > 0:
            return f"called too recently, retry in {wait:.0f}s"
        _STATE["daily"][name] = (date, count + 1)
        _STATE["last_call"][name] = now
    return None


# --------------------------------------------------------------------------
# provider calls
# --------------------------------------------------------------------------
def _call_gemini(cfg, user_prompt, system_prompt=SYSTEM_PROMPT):
    url = f"{cfg['base']}/models/{cfg['model']}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": settings.llm_temperature,
            "maxOutputTokens": max(settings.llm_max_output_tokens, 4096),
            "responseMimeType": "application/json",
        },
    }
    if "flash" in cfg["model"]:
        # Gemini 2.5 Flash spends output tokens on hidden "thinking"; that cut the JSON reply in half.
        body["generationConfig"]["thinkingConfig"] = {"thinkingBudget": 0}
    r = httpx.post(url, json=body, timeout=settings.llm_timeout_seconds,
                   headers={"x-goog-api-key": cfg["key"], "Content-Type": "application/json"})
    r.raise_for_status()
    data = r.json()
    cands = data.get("candidates") or []
    if not cands:
        raise ValueError(f"no candidates (blocked or empty): {data.get('promptFeedback')}")
    parts = (cands[0].get("content") or {}).get("parts") or []
    text = "".join(p.get("text", "") for p in parts if not p.get("thought"))
    if not text.strip():
        raise ValueError(f"empty text, finishReason={cands[0].get('finishReason')}")
    return text


def _call_openai_compat(cfg, user_prompt, system_prompt=SYSTEM_PROMPT):
    body = {
        "model": cfg["model"],
        "messages": [{"role": "system", "content": system_prompt},
                     {"role": "user", "content": user_prompt}],
        "temperature": settings.llm_temperature,
        "max_tokens": max(settings.llm_max_output_tokens, 4096),
        "response_format": {"type": "json_object"},
    }
    # A retired / misspelled model name gives 404 (or 400); try Groq's stable models once before giving up.
    models = [cfg["model"]]
    if cfg.get("label") == "Groq":
        models += [m for m in ("llama-3.3-70b-versatile", "llama-3.1-8b-instant") if m not in models]
    r = None
    for m in models:
        body["model"] = m
        r = httpx.post(f"{cfg['base']}/chat/completions", json=body, timeout=settings.llm_timeout_seconds,
                       headers={"Authorization": f"Bearer {cfg['key']}", "Content-Type": "application/json"})
        if r.status_code not in (400, 404):
            break
    r.raise_for_status()
    text = (r.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
    if not text.strip():
        raise ValueError("empty response")
    return text


def _close_truncated_json(text):
    """Best effort for a reply cut off mid-way: drop the unfinished tail, close brackets."""
    stack, in_str, esc, last_ok = [], False, False, 0
    for i, ch in enumerate(text):
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            stack.append("}" if ch == "{" else "]")
        elif ch in "}]":
            if stack:
                stack.pop()
            last_ok = i + 1
        elif ch == ",":
            last_ok = i
    head = text[:last_ok].rstrip().rstrip(",")
    st, in_str, esc = [], False, False
    for ch in head:
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch in "{[":
            st.append("}" if ch == "{" else "]")
        elif ch in "}]" and st:
            st.pop()
    return head + "".join(reversed(st))


def _parse_json(text):
    """Parse the model reply into the expected shape; tolerate code fences."""
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.IGNORECASE)
    try:
        obj = json.loads(t)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", t, flags=re.DOTALL)
        if not m:
            return {"summary": t[:1200], "key_findings": [], "recommendations": [],
                    "contact_medical_officer": None, "contact_reason": "",
                    "data_gaps": [], "disclaimer": "Demo only, not medical advice."}
        try:
            obj = json.loads(m.group(0))
        except json.JSONDecodeError:
            obj = json.loads(_close_truncated_json(m.group(0)))
    recs = []
    for r in (obj.get("recommendations") or [])[:6]:
        if isinstance(r, dict):
            recs.append({"domain": str(r.get("domain", "general")), "action": str(r.get("action", "")),
                         "priority": str(r.get("priority", "medium")), "evidence": str(r.get("evidence", ""))})
        elif isinstance(r, str):
            recs.append({"domain": "general", "action": r, "priority": "medium", "evidence": ""})
    out = {
        "summary": str(obj.get("summary", "")),
        "key_findings": [str(x) for x in (obj.get("key_findings") or [])][:8],
        "recommendations": recs,
        "contact_medical_officer": obj.get("contact_medical_officer"),
        "contact_reason": str(obj.get("contact_reason", "")),
        "data_gaps": [str(x) for x in (obj.get("data_gaps") or [])][:8],
        "disclaimer": str(obj.get("disclaimer") or "Demo only, not medical advice."),
    }
    if "storm_shelter_steps" in obj:
        out["storm_shelter_steps"] = [str(x) for x in (obj.get("storm_shelter_steps") or [])][:6]
    return out


def _error_text(exc):
    if isinstance(exc, httpx.HTTPStatusError):
        try:
            body = exc.response.json()
            detail = (body.get("error") or {}).get("message") if isinstance(body.get("error"), dict) else str(body.get("error") or "")
        except Exception:  # noqa: BLE001
            detail = (exc.response.text or "")[:120]
        return f"HTTP {exc.response.status_code}" + (f" ({str(detail)[:120]})" if detail else "")
    return f"{type(exc).__name__}: {str(exc)[:160]}"


# --------------------------------------------------------------------------
# public
# --------------------------------------------------------------------------
def generate(context, language="en", system_prompt=None):
    """Return {'source', 'model', 'cached', 'attempts', 'result'}.

    Raises LLMUnavailable if no provider produced an answer. `attempts` lists
    every provider tried and why it failed, so the frontend/demo can show it.
    """
    language = language if language in LANGUAGES else "en"
    system_prompt = system_prompt or SYSTEM_PROMPT
    user_prompt = (
        f"{LANGUAGES[language]}\n\nToday's AstroVital result (JSON):\n"
        + json.dumps(context, ensure_ascii=False, default=str)
    )
    cache_key = hashlib.sha256((system_prompt + user_prompt).encode("utf-8")).hexdigest()
    with _LOCK:
        hit = _STATE["cache"].get(cache_key)
    if hit and time.time() - hit[0] < settings.llm_cache_ttl_seconds:
        return {**hit[1], "cached": True}

    providers = _providers()
    if not providers:
        raise LLMUnavailable("No API key configured (set GEMINI_API_KEY and/or GROK_API_KEY in .env)")

    attempts = []
    for cfg in providers:
        reason = _reserve(cfg["name"])
        if reason:
            attempts.append({"provider": cfg["name"], "ok": False, "error": reason})
            continue
        try:
            text = (_call_gemini(cfg, user_prompt, system_prompt) if cfg["name"] == "gemini"
                    else _call_openai_compat(cfg, user_prompt, system_prompt))
            result = _parse_json(text)
        except Exception as exc:  # noqa: BLE001 - any failure means "try the next provider"
            attempts.append({"provider": cfg["name"], "ok": False, "error": _error_text(exc)})
            continue
        attempts.append({"provider": cfg["name"], "ok": True, "error": None})
        out = {"source": cfg["name"], "model": cfg["model"], "cached": False,
               "attempts": attempts, "result": result}
        with _LOCK:
            _STATE["cache"][cache_key] = (time.time(), out)
        return out
    raise LLMUnavailable("; ".join(f"{a['provider']}: {a['error']}" for a in attempts))


def reset_state():
    """Used by tests."""
    with _LOCK:
        _STATE["cache"].clear()
        _STATE["last_call"].clear()
        _STATE["daily"].clear()