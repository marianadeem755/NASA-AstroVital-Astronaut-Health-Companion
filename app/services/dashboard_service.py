"""Read-only dashboard aggregation. Reuses the existing services/repositories and never
runs the risk or recommendation engines, so loading a dashboard has no side effects."""
from collections import defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from statistics import mean

from sqlalchemy.orm import Session

from app.body_map import symptom_service
from app.core.exceptions import AppError
from app.repositories import (
    alert_repo,
    astronaut_repo,
    body_map_repo,
    observation_repo,
    recommendation_repo,
    risk_repo,
    wellbeing_repo,
)
from app.schemas.dashboard import (
    AlertSummary,
    BodyMapSummary,
    BodyRegionSummary,
    DataQuality,
    OverviewResponse,
    RecommendationSummary,
    RiskPoint,
    RiskSummary,
    TrendsResponse,
    VitalDaily,
    VitalTrend,
)
from app.schemas.observation import to_utc
from app.schemas.risk import RiskAssessmentRead
from app.wellbeing import assessment_service as wellbeing_service
from app.risk_engine.rules import LEVELS

# ---- design choices (not clinical) ---------------------------------------------------
OBSERVATION_STALE_HOURS = 24
BODY_MAP_DAYS = 7
LIST_LIMIT = 5
VITAL_MIN_POINTS = 3
VITAL_TREND_REL = 0.05  # 5% relative change between window halves

VITALS = {
    "heart_rate_bpm": "bpm", "sleep_hours": "h", "spo2_percent": "%", "body_temperature_c": "C",
    "systolic_bp": "mmHg", "diastolic_bp": "mmHg",
}

METHOD_NOTE = (
    f"Vital direction compares the first vs second half of the window (needs >= {VITAL_MIN_POINTS} "
    f"readings, change >= {VITAL_TREND_REL:.0%}); it reports rising/falling, not good/bad. "
    "Wellbeing and symptom trends use their own documented methods."
)


def _require_astronaut(db: Session, astronaut_id: int):
    astronaut = astronaut_repo.get(db, astronaut_id)
    if astronaut is None:
        raise AppError(404, "Astronaut not found")
    return astronaut


# ---- overview ------------------------------------------------------------------------

def overview(db: Session, astronaut_id: int) -> OverviewResponse:
    astronaut = _require_astronaut(db, astronaut_id)
    now = datetime.now(UTC)

    latest_obs = observation_repo.latest_for_astronaut(db, astronaut_id)
    age_minutes = stale = None
    if latest_obs:
        age_minutes = max(0, int((now - to_utc(latest_obs.observed_at)).total_seconds() // 60))
        stale = age_minutes > OBSERVATION_STALE_HOURS * 60

    run = risk_repo.latest_run(db, astronaut_id)
    risk = RiskSummary(
        overall_level=max((a.level for a in run), key=LEVELS.index) if run else None,
        assessed_at=to_utc(run[0].assessed_at) if run else None,
        assessments=[RiskAssessmentRead.model_validate(a) for a in run],
        message=None if run else (
            "No stored risk assessment: analysis has not been run, or it found no concerns."
        ),
    )

    open_alerts, _ = alert_repo.list_for_astronaut(db, astronaut_id, 0, LIST_LIMIT, status="open")
    open_counts = alert_repo.open_counts_by_priority(db, astronaut_id)
    newest_alert = alert_repo.list_for_astronaut(db, astronaut_id, 0, 1)[0]
    recos, _ = recommendation_repo.history(db, astronaut_id, 0, LIST_LIMIT)

    symptoms = symptom_service.trends_for_astronaut(db, astronaut_id, BODY_MAP_DAYS, None, None)
    newest_symptom = body_map_repo.list_for_astronaut(db, astronaut_id, 0, 1)[0]
    body_map = BodyMapSummary(
        window_days=BODY_MAP_DAYS,
        regions=[
            BodyRegionSummary(
                region_code=r.region_code, region_name=r.region_name, count=r.count,
                max_severity=r.max_severity, latest_severity=r.latest_severity,
                latest_reported_at=r.latest_reported_at, trend=r.trend,
            )
            for r in symptoms.regions
        ],
    )

    latest_wellbeing = wellbeing_repo.list_for_astronaut(db, astronaut_id, 0, 1)[0]
    wellbeing = wellbeing_service.to_read(latest_wellbeing[0]) if latest_wellbeing else None

    last_updated = {
        "observations": to_utc(latest_obs.observed_at) if latest_obs else None,
        "risk": risk.assessed_at,
        "alerts": to_utc(newest_alert[0].created_at) if newest_alert else None,
        "recommendations": to_utc(recos[0].created_at) if recos else None,
        "symptoms": to_utc(newest_symptom[0].reported_at) if newest_symptom else None,
        "wellbeing": to_utc(wellbeing.assessed_at) if wellbeing else None,
    }
    return OverviewResponse(
        generated_at=now,
        astronaut=astronaut,
        latest_observation=latest_obs,
        observation_age_minutes=age_minutes,
        observation_stale=stale,
        risk=risk,
        alerts=AlertSummary(
            open_total=sum(open_counts.values()),
            open_by_priority=open_counts,
            latest_open=open_alerts,
        ),
        recommendations=RecommendationSummary(
            latest=recos, escalation_in_latest=any(r.escalation_note for r in recos)
        ),
        body_map=body_map,
        wellbeing=wellbeing,
        data_quality=DataQuality(
            last_updated=last_updated, missing=[k for k, v in last_updated.items() if v is None]
        ),
    )


# ---- trends --------------------------------------------------------------------------

def _vital_direction(points: list[tuple[datetime, float]], start: datetime, end: datetime) -> str:
    if len(points) < VITAL_MIN_POINTS:
        return "insufficient_data"
    midpoint = start + (end - start) / 2
    early = [v for t, v in points if t < midpoint]
    late = [v for t, v in points if t >= midpoint]
    if not early or not late or mean(early) == 0:
        return "insufficient_data"
    change = (mean(late) - mean(early)) / abs(mean(early))
    if abs(change) < VITAL_TREND_REL:
        return "stable"
    return "rising" if change > 0 else "falling"


def compute_vital_trends(observations: Sequence, start: datetime, end: datetime) -> list[VitalTrend]:
    trends = []
    for metric, unit in VITALS.items():
        points = sorted(
            (to_utc(o.observed_at), float(getattr(o, metric)))
            for o in observations if getattr(o, metric) is not None
        )
        if not points:
            continue
        per_day: dict = defaultdict(list)
        for t, v in points:
            per_day[t.date()].append(v)
        values = [v for _, v in points]
        trends.append(
            VitalTrend(
                metric=metric, unit=unit, count=len(values), mean=round(mean(values), 2),
                min=min(values), max=max(values), latest=points[-1][1],
                direction=_vital_direction(points, start, end),
                daily=[
                    VitalDaily(date=d, mean=round(mean(v), 2), min=min(v), max=max(v))
                    for d, v in sorted(per_day.items())
                ],
            )
        )
    return trends


def trends(db: Session, astronaut_id: int, days: int) -> TrendsResponse:
    _require_astronaut(db, astronaut_id)
    end = datetime.now(UTC)
    start = end - timedelta(days=days)

    observations, _ = observation_repo.list_for_astronaut(db, astronaut_id, 0, 10_000, start, end)
    well = wellbeing_service.trends_for_astronaut(db, astronaut_id, days)
    symptoms = symptom_service.trends_for_astronaut(db, astronaut_id, days, None, None)
    risk_points = [
        RiskPoint(assessed_at=to_utc(a.assessed_at), category=a.category, level=a.level, score=a.score)
        for a in risk_repo.in_window(db, astronaut_id, start, end)
    ]
    return TrendsResponse(
        astronaut_id=astronaut_id, window_start=start, window_end=end, days=days,
        vitals=compute_vital_trends(observations, start, end),
        wellbeing=well.wellbeing, cognitive=well.cognitive, symptoms=symptoms.regions,
        risk_history=risk_points, method_note=METHOD_NOTE,
    )
