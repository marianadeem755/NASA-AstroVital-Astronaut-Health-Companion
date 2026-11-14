"""Read CSV / JSON files into plain dict records. No interpretation happens here."""
import csv
import json
from pathlib import Path
from typing import Any

from app.ingestion.errors import IngestionError


def infer_format(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return "csv"
    if suffix == ".json":
        return "json"
    raise IngestionError(f"Unsupported file type '{suffix}'. Use .csv or .json (or set 'format' in the mapping).")


def read_records(path: Path, fmt: str, records_path: str | None = None) -> list[dict[str, Any]]:
    if fmt == "csv":
        return _read_csv(path)
    if fmt == "json":
        return _read_json(path, records_path)
    raise IngestionError(f"Unsupported format '{fmt}'")


def _read_csv(path: Path) -> list[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8-sig", newline="") as handle:
            reader = csv.DictReader(handle)
            if not reader.fieldnames:
                raise IngestionError("CSV file has no header row")
            return [dict(row) for row in reader]
    except UnicodeDecodeError as exc:
        raise IngestionError(f"CSV file is not valid UTF-8: {exc}") from exc
    except csv.Error as exc:
        raise IngestionError(f"Malformed CSV: {exc}") from exc


def _read_json(path: Path, records_path: str | None) -> list[dict[str, Any]]:
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except json.JSONDecodeError as exc:
        raise IngestionError(f"Malformed JSON: {exc}") from exc
    except UnicodeDecodeError as exc:
        raise IngestionError(f"JSON file is not valid UTF-8: {exc}") from exc

    if records_path:
        for key in records_path.split("."):
            if not isinstance(data, dict) or key not in data:
                raise IngestionError(f"records_path '{records_path}' not found in JSON file")
            data = data[key]
    if not isinstance(data, list):
        raise IngestionError(
            "JSON must be a list of records (or set 'records_path' to the list inside an object)"
        )
    # Non-object entries are kept so the importer can report them per row.
    return data
