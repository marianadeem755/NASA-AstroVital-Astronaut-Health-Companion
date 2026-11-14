"""Turns one raw record into the common observation schema, or raises RowError.

Rules: missing values stay missing (never imputed); nothing is guessed; a row without a
parsable timestamp is rejected (times are never invented)."""
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from typing import Any

from pydantic import ValidationError

from app.ingestion.errors import RowError
from app.ingestion.mapping import MappingSpec, TimestampSpec
from app.schemas.observation import ObservationCreate


@dataclass
class NormalizedRow:
    subject: str
    record_id: str
    data: ObservationCreate  # validated; astronaut_id is a placeholder until resolved
    extra: dict[str, Any] = field(default_factory=dict)


def _get(record: dict, path: str) -> Any:
    if path in record:
        return record[path]
    value: Any = record
    for key in path.split("."):
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def _is_missing(value: Any, mapping: MappingSpec) -> bool:
    return value is None or (isinstance(value, str) and value.strip().lower() in mapping.missing_values)


def _tzinfo(spec: TimestampSpec):
    if spec.timezone == "UTC":
        return UTC
    sign = 1 if spec.timezone[0] == "+" else -1
    hours, minutes = spec.timezone[1:].split(":")
    return timezone(sign * timedelta(hours=int(hours), minutes=int(minutes)))


def parse_timestamp(value: Any, spec: TimestampSpec) -> datetime:
    try:
        if spec.format in ("epoch_s", "epoch_ms"):
            if isinstance(value, bool):
                raise ValueError("boolean is not a timestamp")
            seconds = float(value) / (1000 if spec.format == "epoch_ms" else 1)
            return datetime.fromtimestamp(seconds, UTC)
        text = str(value).strip()
        parsed = datetime.fromisoformat(text) if spec.format == "iso" else datetime.strptime(
            text, spec.format.removeprefix("strptime:")
        )
    except (ValueError, OverflowError, OSError) as exc:
        raise RowError(f"unparsable timestamp {value!r} (expected {spec.format})") from exc
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_tzinfo(spec))
    return parsed.astimezone(UTC)


def _number(value: Any, source: str) -> float:
    if isinstance(value, bool):
        raise RowError(f"{source}: boolean is not a number")
    try:
        return float(str(value).strip().replace(",", "")) if isinstance(value, str) else float(value)
    except (TypeError, ValueError) as exc:
        raise RowError(f"{source}: {value!r} is not a number") from exc


def normalise(record: Any, mapping: MappingSpec, row_no: int) -> NormalizedRow:
    if not isinstance(record, dict):
        raise RowError("record is not an object")

    subject = _get(record, mapping.subject_field)
    if _is_missing(subject, mapping):
        raise RowError(f"missing subject ({mapping.subject_field})")
    subject = str(subject).strip()

    if mapping.record_id_field:
        rid = _get(record, mapping.record_id_field)
        if _is_missing(rid, mapping):
            raise RowError(f"missing record id ({mapping.record_id_field})")
        record_id = str(rid).strip()
    else:
        record_id = f"row-{row_no}"
    if len(record_id) > 200:
        raise RowError("record id longer than 200 characters")

    try:
        return _build_row(record, mapping, subject, record_id)
    except RowError as exc:
        exc.record_id = record_id
        raise


def _build_row(record: dict, mapping: MappingSpec, subject: str, record_id: str) -> NormalizedRow:
    raw_time = _get(record, mapping.timestamp.field)
    if _is_missing(raw_time, mapping):
        raise RowError(f"missing timestamp ({mapping.timestamp.field})")
    observed_at = parse_timestamp(raw_time, mapping.timestamp)

    values: dict[str, float] = {}
    for target, fmap in mapping.fields.items():
        raw = _get(record, fmap.source)
        if _is_missing(raw, mapping):
            continue  # stays missing; recorded in missing_fields later
        values[target] = _number(raw, fmap.source) * fmap.scale + fmap.offset

    extra = {
        col: _get(record, col) for col in mapping.extra if not _is_missing(_get(record, col), mapping)
    }
    try:
        data = ObservationCreate(
            astronaut_id=1, observed_at=observed_at, extra_metrics=extra or None, **values
        )
    except ValidationError as exc:
        raise RowError("; ".join(
            f"{'.'.join(str(p) for p in e['loc']) or 'row'}: {e['msg']}" for e in exc.errors()
        )) from exc
    return NormalizedRow(subject=subject, record_id=record_id, data=data, extra=extra)
