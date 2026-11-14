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
    base = settings.grok_base_url or (GROQ_BASE_URL if is_groq else XAI_BASE_URL)
    model = settings.grok_model or (GROQ_DEFAULT_MODEL if is_groq else XAI_DEFAULT_MODEL)
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
def _call_gemini(cfg, user_prompt):
    url = f"{cfg['base']}/models/{cfg['model']}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"role": "user", "parts": [{"text": user_prompt}]}],
        "generationConfig": {
            "temperature": settings.llm_temperature,
            "maxOutputTokens": settings.llm_max_output_tokens,
            "responseMimeType": "application/json",
        },
    }
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


def _call_openai_compat(cfg, user_prompt):
    body = {
        "model": cfg["model"],
        "messages": [{"role": "system", "content": SYSTEM_PROMPT},
                     {"role": "user", "content": user_prompt}],
        "temperature": settings.llm_temperature,
        "max_tokens": settings.llm_max_output_tokens,
        "response_format": {"type": "json_object"},
    }
    r = httpx.post(f"{cfg['base']}/chat/completions", json=body, timeout=settings.llm_timeout_seconds,
                   headers={"Authorization": f"Bearer {cfg['key']}", "Content-Type": "application/json"})
    r.raise_for_status()
    text = (r.json().get("choices") or [{}])[0].get("message", {}).get("content") or ""
    if not text.strip():
        raise ValueError("empty response")
    return text


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
        obj = json.loads(m.group(0))
    recs = []
    for r in (obj.get("recommendations") or [])[:6]:
        if isinstance(r, dict):
            recs.append({"domain": str(r.get("domain", "general")), "action": str(r.get("action", "")),
                         "priority": str(r.get("priority", "medium")), "evidence": str(r.get("evidence", ""))})
        elif isinstance(r, str):
            recs.append({"domain": "general", "action": r, "priority": "medium", "evidence": ""})
    return {
        "summary": str(obj.get("summary", "")),
        "key_findings": [str(x) for x in (obj.get("key_findings") or [])][:8],
        "recommendations": recs,
        "contact_medical_officer": obj.get("contact_medical_officer"),
        "contact_reason": str(obj.get("contact_reason", "")),
        "data_gaps": [str(x) for x in (obj.get("data_gaps") or [])][:8],
        "disclaimer": str(obj.get("disclaimer") or "Demo only, not medical advice."),
    }


def _error_text(exc):
    if isinstance(exc, httpx.HTTPStatusError):
        return f"HTTP {exc.response.status_code}"
    return f"{type(exc).__name__}: {str(exc)[:160]}"


# --------------------------------------------------------------------------
# public
# --------------------------------------------------------------------------
def generate(context, language="en"):
    """Return {'source', 'model', 'cached', 'attempts', 'result'}.

    Raises LLMUnavailable if no provider produced an answer. `attempts` lists
    every provider tried and why it failed, so the frontend/demo can show it.
    """
    language = language if language in LANGUAGES else "en"
    user_prompt = (
        f"{LANGUAGES[language]}\n\nToday's AstroVital result (JSON):\n"
        + json.dumps(context, ensure_ascii=False, default=str)
    )
    cache_key = hashlib.sha256(user_prompt.encode("utf-8")).hexdigest()
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
            text = _call_gemini(cfg, user_prompt) if cfg["name"] == "gemini" else _call_openai_compat(cfg, user_prompt)
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
