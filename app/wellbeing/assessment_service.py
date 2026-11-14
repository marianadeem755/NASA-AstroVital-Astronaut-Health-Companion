"""Wellbeing + cognitive assessments: recording, concern flags and trend analysis.

All thresholds below are DESIGN/CONVENTION choices, not validated clinical cut-offs:
  - 0-10 self-report scales: 7+ (or <=3 for 'higher is better' scales) is flagged, mirroring
    the numeric-rating-scale convention. Replace with the instrument NASA uses.
  - Cognitive scores are compared with the astronaut's OWN baseline (first tests), because
    absolute cognitive values vary a lot between people.
Output wording is descriptive ("self-reported", "possible performance concern"); this module
never produces a psychiatric or medical diagnosis."""
from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from statistics import mean

from sqlalchemy.orm import Session

from app.models.wellbeing import CognitiveAssessment, WellbeingAssessment
from app.repositories import wellbeing_repo
from app.schemas.observation import to_utc
from app.schemas.wellbeing import (
    CognitiveMetricTrend,
    Concern,
    DailyMean,
    MetricTrend,
    WellbeingCreate,
    WellbeingRead,
    WellbeingTrendResponse,
)

# ---- concern rules (most severe first per metric) -----------------------------------
# (metric, op, threshold, level, message)
CONCERN_RULES = [
    ("sleep_quality", "le", 1, "high", "Very poor self-reported sleep quality"),
    ("sleep_quality", "le", 3, "medium", "Poor self-reported sleep quality"),
    ("mood", "le", 1, "high", "Very low self-reported mood"),
    ("mood", "le", 3, "medium", "Low self-reported mood"),
    ("stress", "ge", 9, "high", "Very high self-reported stress"),
    ("stress", "ge", 7, "medium", "High self-reported stress"),
    ("fatigue", "ge", 9, "high", "Very high self-reported fatigue"),
    ("fatigue", "ge", 7, "medium", "High self-reported fatigue"),
]
EVIDENCE = "convention"
LEVELS = ["none", "low", "medium", "high"]

WELLBEING_METRICS = {"sleep_quality": True, "mood": True, "stress": False, "fatigue": False}  # higher_is_better
COGNITIVE_METRICS = {
    "reaction_time_ms": False, "attention_score": True, "memory_score": True, "task_accuracy": True,
}

# trend / baseline tuning (design choices)
MIN_POINTS_FOR_TREND = 3
WELLBEING_TREND_DELTA = 1.0      # points on the 0-10 scale
COGNITIVE_TREND_REL = 0.10       # 10% relative change
BASELINE_N = 5                   # first N measurements define the personal baseline
RECENT_N = 3                     # latest N measurements compared with the baseline
BASELINE_DEVIATION_PCT = 20.0    # worse-direction change that is flagged

METHOD_NOTE = (
    f"Trends compare the first vs second half of the window (needs >= {MIN_POINTS_FOR_TREND} points; "
    f"wellbeing change >= {WELLBEING_TREND_DELTA:g} point, cognitive change >= {COGNITIVE_TREND_REL:.0%}). "
    f"Cognitive baseline = astronaut's first {BASELINE_N} measurements; flagged when the latest "
    f"{RECENT_N} are >= {BASELINE_DEVIATION_PCT:g}% worse (needs {BASELINE_N + RECENT_N}+ measurements). "
    "Thresholds are conventions, not clinical cut-offs."
)


# ---- recording ----------------------------------------------------------------------

def record_assessment(db: Session, data: WellbeingCreate) -> tuple[WellbeingAssessment, bool]:
    """Returns (assessment, created). A repeated client_uuid returns the stored assessment."""
    if data.client_uuid and (existing := wellbeing_repo.get_by_client_uuid(db, data.client_uuid)):
        return existing, False
    assessed_at = data.assessed_at or datetime.now(UTC)
    assessment = WellbeingAssessment(
        astronaut_id=data.astronaut_id, assessed_at=assessed_at,
        sleep_quality=data.sleep_quality, mood=data.mood, stress=data.stress, fatigue=data.fatigue,
        notes=data.notes, client_uuid=data.client_uuid,
    )
    if data.cognitive:
        assessment.cognitive = CognitiveAssessment(
            astronaut_id=data.astronaut_id, assessed_at=assessed_at, **data.cognitive.model_dump()
        )
    return wellbeing_repo.create(db, assessment)


# ---- concerns -----------------------------------------------------------------------

def concerns_for(a: WellbeingAssessment) -> list[Concern]:
    concerns: list[Concern] = []
    seen: set[str] = set()
    for metric, op, threshold, level, message in CONCERN_RULES:
        if metric in seen:
            continue
        value = getattr(a, metric)
        if (op == "le" and value <= threshold) or (op == "ge" and value >= threshold):
            concerns.append(Concern(metric=metric, value=value, level=level, message=message, evidence=EVIDENCE))
            seen.add(metric)  # only the most severe tier per metric
    return concerns


def overall_level(concerns: Sequence[Concern]) -> str:
    """Highest concern level, raised one step when several indicators coincide."""
    if not concerns:
        return "none"
    level = max((c.level for c in concerns), key=LEVELS.index)
    if len(concerns) >= 2:
        level = LEVELS[min(LEVELS.index(level) + 1, len(LEVELS) - 1)]
    return level


def to_read(a: WellbeingAssessment) -> WellbeingRead:
    concerns = concerns_for(a)
    read = WellbeingRead.model_validate(a)
    return read.model_copy(update={"concerns": concerns, "performance_concern_level": overall_level(concerns)})


# ---- trends -------------------------------------------------------------------------

def _direction(points: list[tuple[datetime, float]], start: datetime, end: datetime,
               higher_is_better: bool, relative: bool) -> str:
    if len(points) < MIN_POINTS_FOR_TREND:
        return "insufficient_data"
    midpoint = start + (end - start) / 2
    early = [v for t, v in points if t < midpoint]
    late = [v for t, v in points if t >= midpoint]
    if not early or not late:
        return "insufficient_data"
    early_mean, delta = mean(early), mean(late) - mean(early)
    if relative:
        if early_mean == 0:
            return "insufficient_data"
        significant = abs(delta) / abs(early_mean) >= COGNITIVE_TREND_REL
    else:
        significant = abs(delta) >= WELLBEING_TREND_DELTA
    if not significant:
        return "stable"
    return "improving" if (delta > 0) == higher_is_better else "worsening"


def _metric_trend(metric: str, points: list[tuple[datetime, float]], start: datetime, end: datetime,
                  higher_is_better: bool, relative: bool, cls=MetricTrend):
    per_day: dict = defaultdict(list)
    for t, v in points:
        per_day[t.date()].append(v)
    values = [v for _, v in points]
    return cls(
        metric=metric, higher_is_better=higher_is_better, count=len(values),
        mean=round(mean(values), 2), min=min(values), max=max(values), latest=points[-1][1],
        direction=_direction(points, start, end, higher_is_better, relative),
        daily=[DailyMean(date=d, mean=round(mean(v), 2)) for d, v in sorted(per_day.items())],
    )


def _baseline_check(metric: str, all_values: list[float], higher_is_better: bool) -> dict:
    if len(all_values) < BASELINE_N + RECENT_N:
        return {"baseline_n": len(all_values)}
    baseline, recent = mean(all_values[:BASELINE_N]), mean(all_values[-RECENT_N:])
    if baseline == 0:
        return {"baseline_n": BASELINE_N}
    change = (recent - baseline) / abs(baseline) * 100
    worse = change <= -BASELINE_DEVIATION_PCT if higher_is_better else change >= BASELINE_DEVIATION_PCT
    label = metric.replace("_", " ")
    return {
        "baseline_mean": round(baseline, 2), "baseline_n": BASELINE_N, "recent_mean": round(recent, 2),
        "change_percent": round(change, 1), "deviates_from_baseline": worse,
        "baseline_message": (
            f"Recent {label} is {abs(change):.0f}% {'lower' if change < 0 else 'higher'} than this "
            f"astronaut's baseline - a possible performance concern, not a diagnosis."
            if worse else None
        ),
    }


def compute_trends(
    astronaut_id: int,
    window: Sequence[WellbeingAssessment],
    all_cognitive: Sequence[CognitiveAssessment],
    start: datetime,
    end: datetime,
    days: int,
) -> WellbeingTrendResponse:
    wellbeing = []
    for metric, higher in WELLBEING_METRICS.items():
        points = [(to_utc(a.assessed_at), float(getattr(a, metric))) for a in window]
        if points:
            wellbeing.append(_metric_trend(metric, points, start, end, higher, relative=False))

    cognitive = []
    for metric, higher in COGNITIVE_METRICS.items():
        in_window = [
            (to_utc(a.cognitive.assessed_at), float(getattr(a.cognitive, metric)))
            for a in window if a.cognitive and getattr(a.cognitive, metric) is not None
        ]
        lifetime = [float(getattr(c, metric)) for c in all_cognitive if getattr(c, metric) is not None]
        if not in_window and not lifetime:
            continue
        base = _baseline_check(metric, lifetime, higher)
        if in_window:
            trend = _metric_trend(metric, in_window, start, end, higher, relative=True, cls=CognitiveMetricTrend)
            cognitive.append(trend.model_copy(update=base))
        else:
            # Nothing in this window, but the baseline comparison is still informative.
            cognitive.append(CognitiveMetricTrend(
                metric=metric, higher_is_better=higher, count=0, mean=0, min=0, max=0, latest=lifetime[-1],
                direction="insufficient_data", daily=[], **base,
            ))
    return WellbeingTrendResponse(
        astronaut_id=astronaut_id, window_start=start, window_end=end, days=days,
        assessments_in_window=len(window), wellbeing=wellbeing, cognitive=cognitive, method_note=METHOD_NOTE,
    )


def trends_for_astronaut(db: Session, astronaut_id: int, days: int) -> WellbeingTrendResponse:
    end = datetime.now(UTC)
    start = end - timedelta(days=days)
    return compute_trends(
        astronaut_id,
        wellbeing_repo.in_window(db, astronaut_id, start, end),
        wellbeing_repo.all_cognitive(db, astronaut_id),
        start, end, days,
    )
