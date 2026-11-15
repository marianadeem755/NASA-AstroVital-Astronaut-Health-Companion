"""Dataset mapping files.

One JSON file per dataset describes how its columns map onto the common observation
schema. Supporting a new dataset means writing a mapping file, not code. See
data/sample/mapping.example.json for the format."""
import json
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from app.ingestion.errors import IngestionError
from app.schemas.observation import METRIC_FIELDS

DEFAULT_MISSING = ["", "na", "n/a", "nan", "null", "none", "-", "--"]
_TZ = re.compile(r"^(UTC|[+-]\d{2}:\d{2})$")


class FieldMap(BaseModel):
    source: str = Field(min_length=1)  # column name (JSON: dotted path allowed, e.g. "vitals.hr")
    scale: float = 1.0                 # value * scale + offset  (unit conversion)
    offset: float = 0.0


class TimestampSpec(BaseModel):
    field: str = Field(min_length=1)
    # iso | epoch_s | epoch_ms | strptime:<format>   e.g. "strptime:%d/%m/%Y %H:%M"
    format: str = "iso"
    timezone: str = "UTC"  # applied when the value has no timezone: "UTC" or "+HH:MM"

    @field_validator("format")
    @classmethod
    def _format(cls, v: str) -> str:
        if v in ("iso", "epoch_s", "epoch_ms") or (v.startswith("strptime:") and len(v) > 9):
            return v
        raise ValueError("format must be iso, epoch_s, epoch_ms or strptime:<format>")

    @field_validator("timezone")
    @classmethod
    def _tz(cls, v: str) -> str:
        if not _TZ.match(v):
            raise ValueError('timezone must be "UTC" or a fixed offset like "+02:00"')
        return v


class MappingSpec(BaseModel):
    dataset_name: str = Field(min_length=1, max_length=200)
    source: str | None = Field(default=None, max_length=300)  # URL / citation of the original data
    format: Literal["csv", "json"] | None = None              # inferred from the extension if omitted
    records_path: str | None = None                           # JSON object: dotted path to the record list
    subject_field: str = Field(min_length=1)                  # who the row belongs to
    subject_prefix: str = ""                                  # crew_code = prefix + subject
    record_id_field: str | None = None                        # original record id (strongly recommended)
    timestamp: TimestampSpec                                  # REQUIRED: times are never invented
    fields: dict[str, FieldMap] = Field(default_factory=dict) # observation field -> source column
    extra: list[str] = Field(default_factory=list)            # other columns kept in extra_metrics
    missing_values: list[str] = Field(default_factory=lambda: list(DEFAULT_MISSING))

    @field_validator("fields")
    @classmethod
    def _known_fields(cls, v: dict) -> dict:
        unknown = set(v) - set(METRIC_FIELDS)
        if unknown:
            raise ValueError(f"unknown observation field(s): {sorted(unknown)}; allowed: {METRIC_FIELDS}")
        return v

    @field_validator("missing_values")
    @classmethod
    def _lower(cls, v: list[str]) -> list[str]:
        return [x.strip().lower() for x in v]

    @model_validator(mode="after")
    def _something_to_import(self):
        if not self.fields and not self.extra:
            raise ValueError("mapping needs at least one entry in 'fields' or 'extra'")
        return self


def load_mapping(path: Path) -> MappingSpec:
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise IngestionError(f"Mapping file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise IngestionError(f"Mapping file is not valid JSON: {exc}") from exc
    if isinstance(raw, dict):
        raw = {k: v for k, v in raw.items() if not k.startswith("_")}  # allow "_notice" comments
    try:
        return MappingSpec.model_validate(raw)
    except ValidationError as exc:
        details = "; ".join(f"{'.'.join(str(p) for p in e['loc'])}: {e['msg']}" for e in exc.errors())
        raise IngestionError(f"Invalid mapping: {details}") from exc
