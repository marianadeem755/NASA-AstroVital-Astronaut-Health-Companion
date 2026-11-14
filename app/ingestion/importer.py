"""Dataset import orchestration.

Safety properties:
  - Duplicate protection: the same file (SHA-256) is never imported twice, and a record id
    already imported under the same dataset name is skipped.
  - Atomic: everything is written in one transaction. Any database error = nothing saved.
  - Row errors are logged and skipped; they never abort the import.
  - An import that stores zero rows is not recorded, so it can be retried after fixing the mapping.
  - Imported subjects become flagged placeholder astronauts (inactive, mission 'IMPORTED: ...')
    and are never merged with real crew records.
  - dry_run=True performs all validation and reports counts but writes nothing."""
import hashlib
import logging
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.ingestion import readers
from app.ingestion.errors import IngestionError, RowError
from app.ingestion.mapping import MappingSpec
from app.ingestion.normalizer import normalise
from app.models.astronaut import Astronaut
from app.models.dataset import Dataset
from app.models.observation import Observation
from app.repositories import observation_repo

log = logging.getLogger(__name__)

IMPORTED_PREFIX = "IMPORTED: "
MAX_STORED_ERRORS = 200
FLUSH_EVERY = 1000


@dataclass
class ImportResult:
    dataset_name: str
    file_hash: str
    dry_run: bool
    persisted: bool = False
    dataset_id: int | None = None
    total_rows: int = 0
    imported: int = 0
    skipped_existing: int = 0   # record id already imported under this dataset name
    failed: int = 0
    created_astronauts: list[str] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)
    errors_truncated: bool = False
    refused_reason: str | None = None


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def import_file(db: Session, path: Path, mapping: MappingSpec, dry_run: bool = False) -> ImportResult:
    path = Path(path)
    if not path.is_file():
        raise IngestionError(f"File not found: {path}")
    result = ImportResult(dataset_name=mapping.dataset_name, file_hash=file_sha256(path), dry_run=dry_run)

    previous = db.scalar(select(Dataset.id).where(Dataset.file_hash == result.file_hash))
    if previous is not None:
        result.refused_reason = f"This exact file was already imported (dataset id {previous})"
        return result

    fmt = mapping.format or readers.infer_format(path)
    records = readers.read_records(path, fmt, mapping.records_path)
    result.total_rows = len(records)

    already = set(db.scalars(
        select(Observation.source_record_id)
        .join(Dataset, Dataset.id == Observation.dataset_id)
        .where(Dataset.name == mapping.dataset_name)
    ))
    seen: set[str] = set()
    astronaut_cache: dict[str, int | None] = {}  # crew_code -> id (None = would be created, dry run)
    observations: list[Observation] = []

    def log_error(row_no: int, record_id: str | None, message: str) -> None:
        result.failed += 1
        if len(result.errors) < MAX_STORED_ERRORS:
            result.errors.append({"row": row_no, "record_id": record_id, "error": message})
        else:
            result.errors_truncated = True

    def resolve_astronaut(subject: str) -> int | None:
        crew_code = f"{mapping.subject_prefix}{subject}"
        if len(crew_code) > 50:
            raise RowError(f"crew code '{crew_code[:20]}...' longer than 50 characters")
        if crew_code in astronaut_cache:
            return astronaut_cache[crew_code]
        existing = db.scalar(select(Astronaut).where(Astronaut.crew_code == crew_code))
        if existing is not None:
            if not (existing.mission_name or "").startswith(IMPORTED_PREFIX):
                raise RowError(f"crew code '{crew_code}' belongs to a non-imported astronaut; "
                               "set subject_prefix in the mapping to avoid the collision")
            astronaut_cache[crew_code] = existing.id
        elif dry_run:
            astronaut_cache[crew_code] = None
            result.created_astronauts.append(crew_code)
        else:
            astronaut = Astronaut(
                crew_code=crew_code, full_name=f"Imported subject {subject}",
                mission_name=(IMPORTED_PREFIX + mapping.dataset_name)[:120], is_active=False,
            )
            db.add(astronaut)
            db.flush()
            astronaut_cache[crew_code] = astronaut.id
            result.created_astronauts.append(crew_code)
        return astronaut_cache[crew_code]

    dataset = None
    try:
        if not dry_run:
            dataset = Dataset(
                name=mapping.dataset_name, source=mapping.source, file_name=path.name,
                file_hash=result.file_hash, format=fmt, records_total=len(records),
            )
            db.add(dataset)
            db.flush()

        for row_no, record in enumerate(records, start=1):
            rid = None
            try:
                row = normalise(record, mapping, row_no)
                rid = row.record_id
                if rid in seen:
                    raise RowError("duplicate record id within this file")
                seen.add(rid)
                if rid in already:
                    result.skipped_existing += 1
                    continue
                astronaut_id = resolve_astronaut(row.subject)
                if dry_run:
                    result.imported += 1
                    continue
                obs = observation_repo.build(row.data)
                obs.astronaut_id, obs.dataset_id, obs.source_record_id = astronaut_id, dataset.id, rid
                observations.append(obs)
                result.imported += 1
                if len(observations) >= FLUSH_EVERY:
                    db.add_all(observations)
                    db.flush()
                    observations.clear()
            except RowError as exc:
                log_error(row_no, exc.record_id or rid, str(exc))

        if dry_run:
            return result
        if result.imported == 0:
            db.rollback()  # nothing stored -> do not register the file; fix the mapping and retry
            result.refused_reason = "No valid rows to import (nothing was saved)"
            return result

        db.add_all(observations)
        dataset.records_imported, dataset.records_failed = result.imported, result.failed
        dataset.import_errors = result.errors or None
        dataset.imported_at = datetime.now(UTC)
        db.commit()
        result.persisted, result.dataset_id = True, dataset.id
        return result
    except Exception as exc:
        db.rollback()
        log.exception("dataset import failed; transaction rolled back")
        raise IngestionError(f"Import failed and was rolled back; nothing was saved ({exc})") from exc
