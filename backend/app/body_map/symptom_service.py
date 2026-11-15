"""Body-map logic: record symptoms (idempotently) and compute per-region trends.

compute_trends() is pure (reports in, summaries out). Symptom data is descriptive only:
nothing here diagnoses a condition."""
from collections import Counter, defaultdict
from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from statistics import mean

from sqlalchemy.orm import Session

from app.core.exceptions import AppError
from app.models.body_map import SymptomReport
from app.repositories import body_map_repo
from app.schemas.body_map import DailyPoint, RegionTrend, SymptomCreate, TrendResponse
from app.schemas.observation import to_utc

# Design choices (not clinical): minimum reports for a trend, and the severity change
# (on the 1-10 scale) between the first and second half of the window that counts as a trend.
MIN_REPORTS_FOR_TREND = 3
TREND_DELTA = 1.0

METHOD_NOTE = (
    "Trend compares mean severity in the first vs second half of the window "
    f"(needs >= {MIN_REPORTS_FOR_TREND} reports, change >= {TREND_DELTA:g} points). "
    "Descriptive only; not a diagnosis."
)


def record_symptom(db: Session, data: SymptomCreate) -> tuple[SymptomReport, bool]:
    """Returns (report, created). A repeated client_uuid returns the stored report."""
    region = body_map_repo.get_region_by_code(db, data.region_code)
    if region is None:
        valid = ", ".join(r.code for r in body_map_repo.list_regions(db))
        raise AppError(422, f"Unknown body region '{data.region_code}'. Valid regions: {valid}")

    if data.client_uuid and (existing := body_map_repo.get_by_client_uuid(db, data.client_uuid)):
        return existing, False

    report = SymptomReport(
        astronaut_id=data.astronaut_id,
        body_region_id=region.id,
        symptom_type=data.symptom_type,
        severity=data.severity,
        duration_minutes=data.duration_minutes,
        notes=data.notes,
        reported_at=data.reported_at or datetime.now(UTC),
        client_uuid=data.client_uuid,
    )
    return body_map_repo.create(db, report)


def _trend_direction(reports: Sequence[SymptomReport], start: datetime, end: datetime) -> str:
    if len(reports) < MIN_REPORTS_FOR_TREND:
        return "insufficient_data"
    midpoint = start + (end - start) / 2
    early = [r.severity for r in reports if to_utc(r.reported_at) < midpoint]
    late = [r.severity for r in reports if to_utc(r.reported_at) >= midpoint]
    if not early or not late:
        return "insufficient_data"
    delta = mean(late) - mean(early)
    if delta >= TREND_DELTA:
        return "worsening"
    if delta <= -TREND_DELTA:
        return "improving"
    return "stable"


def compute_trends(
    astronaut_id: int, reports: Sequence[SymptomReport], start: datetime, end: datetime, days: int
) -> TrendResponse:
    by_region: dict[str, list[SymptomReport]] = defaultdict(list)
    for report in reports:
        by_region[report.region_code].append(report)

    regions: list[RegionTrend] = []
    for code, items in by_region.items():
        items.sort(key=lambda r: (to_utc(r.reported_at), r.id))
        per_day: dict = defaultdict(list)
        for r in items:
            per_day[to_utc(r.reported_at).date()].append(r.severity)
        latest = items[-1]
        regions.append(
            RegionTrend(
                region_code=code,
                region_name=latest.region_name,
                count=len(items),
                mean_severity=round(mean(r.severity for r in items), 2),
                max_severity=max(r.severity for r in items),
                latest_severity=latest.severity,
                latest_reported_at=to_utc(latest.reported_at),
                trend=_trend_direction(items, start, end),
                symptom_types=dict(Counter(r.symptom_type for r in items).most_common()),
                daily=[
                    DailyPoint(date=d, count=len(s), max_severity=max(s), mean_severity=round(mean(s), 2))
                    for d, s in sorted(per_day.items())
                ],
            )
        )
    # Most concerning first: highest recent severity, then volume.
    regions.sort(key=lambda t: (t.latest_severity, t.count), reverse=True)
    return TrendResponse(
        astronaut_id=astronaut_id, window_start=start, window_end=end, days=days,
        total_reports=len(reports), regions=regions, method_note=METHOD_NOTE,
    )


def trends_for_astronaut(
    db: Session, astronaut_id: int, days: int, region_code: str | None, symptom_type: str | None
) -> TrendResponse:
    region_id = None
    if region_code:
        region = body_map_repo.get_region_by_code(db, region_code)
        if region is None:
            raise AppError(422, f"Unknown body region '{region_code}'")
        region_id = region.id
    end = datetime.now(UTC)
    start = end - timedelta(days=days)
    reports = body_map_repo.all_in_window(db, astronaut_id, start, end, region_id, symptom_type)
    return compute_trends(astronaut_id, reports, start, end, days)
