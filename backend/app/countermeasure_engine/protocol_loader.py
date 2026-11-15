"""Loads protocol definitions from JSON into SQLite.

Rules:
  - Entries are validated (ProtocolImport) before anything is written.
  - Existing (code, version) rows are NEVER modified: change a protocol by adding a new
    version, so history stays accurate.
  - Loaded protocols are INACTIVE / pending approval unless activate=True. Activation is
    an approval decision; use it only for local development."""
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.countermeasure_engine.safety_checker import APPROVED_STATUS
from app.models.countermeasure import CountermeasureProtocol
from app.schemas.recommendation import ProtocolImport


def load_protocols_file(db: Session, path: Path, activate: bool = False) -> dict:
    raw = json.loads(path.read_text(encoding="utf-8"))
    items = raw["protocols"] if isinstance(raw, dict) else raw
    summary = {"inserted": 0, "skipped_existing": 0, "invalid": []}
    for index, item in enumerate(items):
        try:
            data = ProtocolImport.model_validate(item)
        except Exception as exc:  # pydantic ValidationError
            summary["invalid"].append({"index": index, "error": str(exc)})
            continue
        exists = db.scalar(
            select(CountermeasureProtocol.id).where(
                CountermeasureProtocol.code == data.code,
                CountermeasureProtocol.version == data.version,
            )
        )
        if exists:
            summary["skipped_existing"] += 1
            continue
        db.add(
            CountermeasureProtocol(
                **data.model_dump(),
                approval_status=APPROVED_STATUS if activate else "pending_approval",
                is_active=activate,
            )
        )
        summary["inserted"] += 1
    db.commit()
    return summary
