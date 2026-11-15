"""ML + AI recommendation tests. Model/data tests are skipped if the files are not
in place; the AI tests use a fake HTTP layer, so they never call a real API."""
import json

import httpx
import pytest

from app.core.config import settings
from app.ml import data_store, predict
from app.services import llm_service

needs_models = pytest.mark.skipif(
    not (settings.models_dir / "sleep_poor_logreg.pkl").exists(), reason="models/ not copied yet")
needs_data = pytest.mark.skipif(
    not list(settings.data_dir.rglob("MMASH_sleep_summary*.csv")), reason="data/ files not copied yet")


@pytest.fixture(autouse=True)
def _clean_llm(monkeypatch):
    llm_service.reset_state()
    monkeypatch.setattr(settings, "llm_min_interval_seconds", 0.0)
    monkeypatch.setattr(settings, "gemini_api_key", "")
    monkeypatch.setattr(settings, "grok_api_key", "")
    yield
    llm_service.reset_state()


def _fake_post(calls, gemini_status=200, grok_status=200):
    gemini_json = {"candidates": [{"content": {"parts": [{"text": json.dumps({
        "summary": "gemini summary", "key_findings": ["a"], "recommendations": [
            {"domain": "sleep", "action": "rest", "priority": "high", "evidence": "weak"}],
        "contact_medical_officer": False, "contact_reason": "", "data_gaps": [], "disclaimer": "Demo only"})}]}}]}
    grok_json = {"choices": [{"message": {"content": json.dumps({"summary": "grok summary"})}}]}

    def post(url, **kwargs):
        calls.append(url)
        req = httpx.Request("POST", url)
        if "generativelanguage" in url:
            return httpx.Response(gemini_status, json=gemini_json, request=req)
        return httpx.Response(grok_status, json=grok_json, request=req)

    return post


CTX = {"level": "amber", "flags": ["x"], "scores": {"a": 1}}


def test_gemini_is_primary(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "g-key")
    monkeypatch.setattr(settings, "grok_api_key", "x-key")
    calls = []
    monkeypatch.setattr(httpx, "post", _fake_post(calls))
    out = llm_service.generate(CTX)
    assert out["source"] == "gemini" and out["result"]["summary"] == "gemini summary"
    assert len(calls) == 1


def test_falls_back_to_grok_when_gemini_fails(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "g-key")
    monkeypatch.setattr(settings, "grok_api_key", "x-key")
    calls = []
    monkeypatch.setattr(httpx, "post", _fake_post(calls, gemini_status=429))
    out = llm_service.generate(CTX)
    assert out["source"] == "grok"
    assert [a["ok"] for a in out["attempts"]] == [False, True]
    assert out["attempts"][0]["error"] == "HTTP 429"


def test_groq_key_uses_groq_defaults(monkeypatch):
    monkeypatch.setattr(settings, "grok_api_key", "gsk_abc")
    calls = []
    monkeypatch.setattr(httpx, "post", _fake_post(calls))
    out = llm_service.generate(CTX)
    assert out["source"] == "grok" and "api.groq.com" in calls[0]


def test_both_fail_raises(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "g-key")
    monkeypatch.setattr(settings, "grok_api_key", "x-key")
    monkeypatch.setattr(httpx, "post", _fake_post([], gemini_status=500, grok_status=500))
    with pytest.raises(llm_service.LLMUnavailable):
        llm_service.generate(CTX)


def test_no_keys_raises():
    with pytest.raises(llm_service.LLMUnavailable):
        llm_service.generate(CTX)


def test_cache_saves_quota(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "g-key")
    calls = []
    monkeypatch.setattr(httpx, "post", _fake_post(calls))
    llm_service.generate(CTX)
    again = llm_service.generate(CTX)
    assert again["cached"] is True and len(calls) == 1


def test_daily_limit_skips_provider(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "g-key")
    monkeypatch.setattr(settings, "grok_api_key", "x-key")
    monkeypatch.setattr(settings, "llm_daily_limit_gemini", 0)
    calls = []
    monkeypatch.setattr(httpx, "post", _fake_post(calls))
    out = llm_service.generate(CTX)
    assert out["source"] == "grok" and "daily limit" in out["attempts"][0]["error"]
    assert not any("generativelanguage" in c for c in calls)


def test_status_never_returns_keys(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "SECRET-KEY")
    body = client.get("/api/v1/ml/status").text
    assert "SECRET-KEY" not in body


@needs_models
def test_flag_rules_unchanged():
    r = predict.astrovital_flag(hrv_anomaly_frac=0.5, blood_proba=0.9)
    assert r["level"] == "red" and r["n_strong_flags"] == 2
    assert predict.astrovital_flag()["level"] == "unknown"


@needs_models
def test_bone_endpoint(client):
    r = client.post("/api/v1/ml/bone-risk", json={"bone_profile": {"age": 60, "sex_female": 1, "bmi": 24}})
    assert r.status_code == 200
    body = r.json()
    assert body["bone_risk_label"] in {"Low", "Medium", "High"}
    assert abs(sum(body["probabilities"].values()) - 1) < 0.01


@needs_models
@needs_data
def test_scenarios_match_team_demo(client):
    demo_path = settings.models_dir / "demo_results.json"
    if not demo_path.exists() or not data_store.crew_map()["scenarios"]:
        pytest.skip("demo_results.json or crew_map.json missing")
    demo = json.loads(demo_path.read_text(encoding="utf-8"))
    for sc in data_store.crew_map()["scenarios"]:
        sid = sc["scenario_id"]
        if sid in demo:
            r = client.get("/api/v1/ml/check-day", params={"scenario_id": sid})
            assert r.status_code == 200
            assert r.json()["level"] == demo[sid]["level"], sid


@needs_models
@needs_data
def test_recommendations_without_keys_falls_back_to_rules(client):
    r = client.get("/api/v1/ml/recommendations", params={"scenario_id": "B_R+1_bad_day"})
    assert r.status_code == 200
    body = r.json()
    assert body["ai"]["source"] == "rules_only"
    assert body["check_day"]["recommendations"]  # rule-based advice is always there


@needs_models
@needs_data
def test_unknown_ids_give_404(client):
    assert client.get("/api/v1/ml/check-day", params={"mmash_user": "nope"}).status_code == 404
    assert client.get("/api/v1/ml/check-day", params={"scenario_id": "nope"}).status_code == 404
    assert client.get("/api/v1/ml/check-day",
                      params={"blood_astronaut": "C001", "timepoint": "R+999"}).status_code == 404


# ---------------------------------------------------------------------------
# Radiation Monitor AI advice (fake HTTP layer, no real API call)
# ---------------------------------------------------------------------------
def _radiation_payload(**over):
    body = {
        "mission": "mars", "mission_label": "Mars mission", "mission_day": 120, "mission_total_days": 860,
        "phase": "Transit out", "phase_days_left": 60, "environment": "Deep-space transit",
        "dose_rate_msv_per_day": 1.84, "dose_to_date_msv": 220.8, "prior_career_dose_msv": 0,
        "career_dose_now_msv": 220.8, "career_dose_end_of_plan_msv": 982.4, "share_of_nasa_limit_now_pct": 36.8,
        "share_of_nasa_limit_end_pct": 163.7, "plan_crosses_nasa_limit_on_day": 326,
        "shielding_scenario": "Baseline hull and habitat", "shielding_factor": 1.0, "shielding_saving_msv": 0,
        "transit_dose_share_pct": 67.4, "phases": [
            {"label": "Transit out", "environment": "Deep-space transit", "days": 180, "rate_msv_per_day": 1.84, "dose_msv": 331.2}],
    }
    body.update(over)
    return body


def test_radiation_recommendations_use_ai_and_keep_shelter_steps(client, monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "test-key")
    reply = {"summary": "s", "recommendations": [
        {"domain": "radiation", "action": "Plan shorter transit", "priority": "high", "evidence": "proxy"}],
        "storm_shelter_steps": ["Go to shelter"], "contact_medical_officer": True, "contact_reason": "over limit"}
    gemini = {"candidates": [{"content": {"parts": [{"text": json.dumps(reply)}]}}]}
    monkeypatch.setattr(httpx, "post", lambda url, **kw: httpx.Response(200, json=gemini, request=httpx.Request("POST", url)))
    r = client.post("/api/v1/ml/radiation-recommendations", json=_radiation_payload())
    assert r.status_code == 200
    ai = r.json()["ai"]
    assert ai["source"] == "gemini"
    assert ai["result"]["recommendations"][0]["action"] == "Plan shorter transit"
    assert ai["result"]["storm_shelter_steps"] == ["Go to shelter"]


def test_radiation_recommendations_report_error_without_keys(client):
    r = client.post("/api/v1/ml/radiation-recommendations", json=_radiation_payload())
    assert r.status_code == 200
    assert r.json()["ai"]["source"] == "rules_only" and r.json()["ai"]["result"] is None


def test_radiation_recommendations_validate_input(client):
    assert client.post("/api/v1/ml/radiation-recommendations", json=_radiation_payload(dose_to_date_msv=-5)).status_code == 422


def test_gemini_cut_off_json_is_repaired_and_groq_key_ignores_xai_config(monkeypatch):
    cut = '{"summary": "ok", "recommendations": [{"domain": "radiation", "action": "a", "priority": "high", "evidence": "proxy"}, {"domain": "radiation", "action": "unfinis'
    out = llm_service._parse_json(cut)
    assert out["summary"] == "ok" and out["recommendations"][0]["action"] == "a"
    monkeypatch.setattr(settings, "grok_api_key", "gsk_abc")
    monkeypatch.setattr(settings, "grok_base_url", "https://api.x.ai/v1")
    monkeypatch.setattr(settings, "grok_model", "grok-4.7")
    cfg = llm_service._grok_config()
    assert "api.groq.com" in cfg["base"] and not cfg["model"].startswith("grok")


def test_gemini_failure_moves_straight_to_grok(monkeypatch):
    monkeypatch.setattr(settings, "gemini_api_key", "g")
    monkeypatch.setattr(settings, "grok_api_key", "gsk_abc")
    monkeypatch.setattr(settings, "grok_base_url", "https://api.x.ai/v1")
    monkeypatch.setattr(settings, "grok_model", "grok-4.7")
    calls = []
    monkeypatch.setattr(httpx, "post", _fake_post(calls, gemini_status=429))
    out = llm_service.generate({"x": 1})
    assert out["source"] == "grok" and "api.groq.com" in calls[-1]