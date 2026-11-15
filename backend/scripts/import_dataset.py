"""Import a CSV/JSON dataset into the local database using a mapping file.

Usage (from the project root):
    python -m scripts.import_dataset data/raw/my_file.csv --mapping data/mappings/my_dataset.json --dry-run
    python -m scripts.import_dataset data/raw/my_file.csv --mapping data/mappings/my_dataset.json

Always run with --dry-run first: it validates every row and reports what would happen,
without writing anything. See data/sample/mapping.example.json for the mapping format.

Exit codes: 0 = imported (or dry run OK), 1 = refused/failed, 2 = bad arguments/mapping.
"""
import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.database import engine, init_db
from app.ingestion.errors import IngestionError
from app.ingestion.importer import import_file
from app.ingestion.mapping import load_mapping

SHOWN_ERRORS = 20


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path, help="CSV or JSON file to import")
    parser.add_argument("--mapping", type=Path, required=True, help="mapping JSON file")
    parser.add_argument("--dry-run", action="store_true", help="validate and report only; write nothing")
    args = parser.parse_args(argv)

    try:
        mapping = load_mapping(args.mapping)
    except IngestionError as exc:
        print(f"Mapping error: {exc}", file=sys.stderr)
        return 2

    init_db()
    try:
        with Session(engine) as db:
            result = import_file(db, args.file, mapping, dry_run=args.dry_run)
    except IngestionError as exc:
        print(f"Import error: {exc}", file=sys.stderr)
        return 1

    summary = asdict(result)
    hidden = max(0, len(summary["errors"]) - SHOWN_ERRORS)
    summary["errors"] = summary["errors"][:SHOWN_ERRORS]
    if hidden:
        summary["errors_not_shown"] = hidden
    print(json.dumps(summary, indent=2, default=str))
    if args.dry_run:
        print("DRY RUN: nothing was written.")
    return 1 if result.refused_reason else 0


if __name__ == "__main__":
    raise SystemExit(main())
