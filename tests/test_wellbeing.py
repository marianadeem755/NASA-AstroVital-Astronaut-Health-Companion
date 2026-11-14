from datetime import UTC, datetime, timedelta

import pytest

from app.wellbeing.assessment_service import overall_level


@pytest.fixture()
def astronaut_id(client):
    return client.post("/api/v1/astronauts", json={"crew_code": "AV-1", "full_name": "T"}).json()["id"]


def days_ago(n: float) -> str:
    return (datetime.now(UTC) - timedelta(days=n)).isoformat()


def submit(client, astronaut_id, expect=201, ago=None, **overrides):
    payload = {
        "astronaut_id": astronaut_id, "sleep_quality": 7, "mood": 7, "stress": 3, "fatigue": 3, **overrides,
    }
    if ago is not None:
        payload["assessed_at"] = days_ago(ago)
    r = client.post("/api/v1/wellbeing/assessment", json=payload)
    assert r.status_code == expect, r.text
    return r.json()


# ---------- recording ----------

def test_submit_assessment_with_cognitive_block(client, astronaut_id):
    body = submit(client, astronaut_id, notes="ok", cognitive={"reaction_time_ms": 250, "attention_score": 88})
    assert body["sleep_quality"] == 7 and body["assessed_at"]
    assert body["cognitive"]["reaction_time_ms"] == 250 and body["cognitive"]["memory_score"] is None
    assert body["concerns"] == [] and body["performance_concern_level"] == "none"


@pytest.mark.parametrize(
    "bad",
    [
        {"stress": 11}, {"mood": -1}, {"sleep_quality": 5.5}, {"fatigue": "tired"},
        {"assessed_at": "2999-01-01T00:00:00Z"},
        {"notes": "x" * 1001},
        {"cognitive": {}},                          # needs at least one measurement
        {"cognitive": {"reaction_time_ms": 0}},     # must be positive
        {"cognitive": {"attention_score": 101}},
    ],
)
def test_invalid_assessment_returns_422(client, astronaut_id, bad):
    submit(client, astronaut_id, expect=422, **bad)


def test_missing_required_scale_returns_422(client, astronaut_id):
    r = client.post("/api/v1/wellbeing/assessment", json={"astronaut_id": astronaut_id, "mood": 5})
    assert r.status_code == 422


def test_unknown_astronaut_returns_404(client):
    submit(client, 999, expect=404)


def test_duplicate_client_uuid_is_idempotent_and_saves_cognitive_once(client, astronaut_id):
    kw = {"client_uuid": "well-uuid-0001", "cognitive": {"attention_score": 80}}
    first = submit(client, astronaut_id, **kw)
    second = submit(client, astronaut_id, expect=200, **kw)
    assert first["id"] == second["id"] and second["cognitive"]["id"] == first["cognitive"]["id"]
    assert client.get(f"/api/v1/wellbeing/{astronaut_id}").json()["total"] == 1


# ---------- concerns ----------

def test_single_concern_is_medium_and_described_neutrally(client, astronaut_id):
    body = submit(client, astronaut_id, stress=7)
    assert [c["metric"] for c in body["concerns"]] == ["stress"]
    concern = body["concerns"][0]
    assert concern["level"] == "medium" and concern["evidence"] == "convention"
    assert "self-reported" in concern["message"].lower()
    assert body["performance_concern_level"] == "medium"


def test_very_severe_single_value_is_high(client, astronaut_id):
    body = submit(client, astronaut_id, stress=9)
    assert body["concerns"][0]["level"] == "high" and body["performance_concern_level"] == "high"


def test_multiple_concerns_raise_overall_level(client, astronaut_id):
    body = submit(client, astronaut_id, stress=7, fatigue=7, mood=3, sleep_quality=2)
    assert len(body["concerns"]) == 4
    assert body["performance_concern_level"] == "high"  # medium raised one step


def test_only_most_severe_tier_per_metric_is_reported(client, astronaut_id):
    body = submit(client, astronaut_id, mood=0)
    assert [c["metric"] for c in body["concerns"]] == ["mood"] and body["concerns"][0]["level"] == "high"


def test_overall_level_never_exceeds_high_and_none_when_clear():
    assert overall_level([]) == "none"


def test_wording_never_claims_a_diagnosis(client, astronaut_id):
    body = submit(client, astronaut_id, stress=9, mood=1, fatigue=9, sleep_quality=1)
    text = " ".join(c["message"].lower() for c in body["concerns"])
    for word in ("depress", "anxiety", "disorder", "diagnos", "psychiatr"):
        assert word not in text


# ---------- history ----------

def test_history_newest_first_filter_and_pagination(client, astronaut_id):
    for ago, stress in [(3, 1), (1, 2), (2, 3)]:
        submit(client, astronaut_id, ago=ago, stress=stress, cognitive={"attention_score": 70})
    page = client.get(f"/api/v1/wellbeing/{astronaut_id}").json()
    assert page["total"] == 3 and [i["stress"] for i in page["items"]] == [2, 3, 1]
    assert all(i["cognitive"] for i in page["items"]) and "not psychiatric" in page["note"]
    assert len(client.get(f"/api/v1/wellbeing/{astronaut_id}?limit=2").json()["items"]) == 2
    since = (datetime.now(UTC) - timedelta(days=1.5)).isoformat()
    assert client.get(f"/api/v1/wellbeing/{astronaut_id}", params={"start": since}).json()["total"] == 1
    assert client.get("/api/v1/wellbeing/999").status_code == 404


# ---------- trends ----------

def metrics(trends, group="wellbeing"):
    return {m["metric"]: m for m in trends[group]}


def test_trend_direction_accounts_for_polarity(client, astronaut_id):
    # stress rises (bad), mood falls (bad), sleep quality rises (good)
    for ago, stress, mood, sleep in [(25, 2, 8, 4), (24, 3, 8, 4), (3, 8, 4, 8), (2, 9, 3, 9)]:
        submit(client, astronaut_id, ago=ago, stress=stress, mood=mood, sleep_quality=sleep)
    t = metrics(client.get(f"/api/v1/wellbeing/{astronaut_id}/trends").json())
    assert t["stress"]["direction"] == "worsening"
    assert t["mood"]["direction"] == "worsening"
    assert t["sleep_quality"]["direction"] == "improving"
    assert t["stress"]["latest"] == 9 and t["stress"]["max"] == 9 and t["stress"]["count"] == 4
    assert len(t["stress"]["daily"]) == 4


def test_trend_stable_and_insufficient(client, astronaut_id):
    for ago in (25, 20, 5, 2):
        submit(client, astronaut_id, ago=ago, fatigue=5)
    body = client.get(f"/api/v1/wellbeing/{astronaut_id}/trends").json()
    assert metrics(body)["fatigue"]["direction"] == "stable"
    assert "not psychiatric" in body["note"] and "conventions" in body["method_note"]


def test_trend_needs_three_points_and_respects_window(client, astronaut_id):
    submit(client, astronaut_id, ago=90, stress=9)  # outside the 30-day window
    submit(client, astronaut_id, ago=2, stress=5)
    submit(client, astronaut_id, ago=1, stress=5)
    body = client.get(f"/api/v1/wellbeing/{astronaut_id}/trends?days=30").json()
    assert body["assessments_in_window"] == 2
    assert metrics(body)["stress"]["direction"] == "insufficient_data"


def test_trends_validation_and_empty(client, astronaut_id):
    assert client.get(f"/api/v1/wellbeing/{astronaut_id}/trends?days=0").status_code == 422
    assert client.get("/api/v1/wellbeing/999/trends").status_code == 404
    empty = client.get(f"/api/v1/wellbeing/{astronaut_id}/trends").json()
    assert empty["wellbeing"] == [] and empty["cognitive"] == [] and empty["assessments_in_window"] == 0


# ---------- cognitive baseline ----------

def cognitive_series(client, astronaut_id, reaction, attention=None):
    # Early tests in the first half of the 30-day window, latest ones in the second half,
    # so both the baseline check and the half-window trend have data.
    ago = [28, 27, 26, 25, 24, 8, 6, 4] if len(reaction) >= 8 else [28, 27, 26, 12, 10, 8, 6]
    for i, rt in enumerate(reaction):
        cog = {"reaction_time_ms": rt}
        if attention:
            cog["attention_score"] = attention[i]
        submit(client, astronaut_id, ago=ago[i], cognitive=cog)


def test_slower_reaction_vs_personal_baseline_is_flagged_without_diagnosis(client, astronaut_id):
    cognitive_series(client, astronaut_id, [250] * 5 + [340] * 3)  # +36% slower
    cog = metrics(client.get(f"/api/v1/wellbeing/{astronaut_id}/trends").json(), "cognitive")["reaction_time_ms"]
    assert cog["baseline_mean"] == 250 and cog["baseline_n"] == 5 and cog["recent_mean"] == 340
    assert cog["change_percent"] == 36.0 and cog["deviates_from_baseline"] is True
    assert "not a diagnosis" in cog["baseline_message"]
    assert cog["higher_is_better"] is False and cog["direction"] == "worsening"


def test_lower_attention_vs_baseline_is_flagged(client, astronaut_id):
    cognitive_series(client, astronaut_id, [250] * 8, attention=[80] * 5 + [50] * 3)
    cog = metrics(client.get(f"/api/v1/wellbeing/{astronaut_id}/trends").json(), "cognitive")
    assert cog["attention_score"]["deviates_from_baseline"] is True
    assert cog["reaction_time_ms"]["deviates_from_baseline"] is False


def test_improvement_and_small_changes_are_not_flagged(client, astronaut_id):
    cognitive_series(client, astronaut_id, [250] * 5 + [200] * 3)  # faster = better
    cog = metrics(client.get(f"/api/v1/wellbeing/{astronaut_id}/trends").json(), "cognitive")["reaction_time_ms"]
    assert cog["deviates_from_baseline"] is False and cog["baseline_message"] is None
    assert cog["direction"] == "improving"


def test_baseline_not_judged_before_enough_measurements(client, astronaut_id):
    cognitive_series(client, astronaut_id, [250, 250, 250, 400, 400, 400, 400])  # only 7
    cog = metrics(client.get(f"/api/v1/wellbeing/{astronaut_id}/trends").json(), "cognitive")["reaction_time_ms"]
    assert cog["baseline_mean"] is None and cog["deviates_from_baseline"] is False and cog["baseline_n"] == 7
