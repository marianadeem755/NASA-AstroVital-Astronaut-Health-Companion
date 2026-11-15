"""Load countermeasure protocols from a JSON file into the local database.

Usage (from project root):
    python -m scripts.load_protocols data/sample/protocols.example.json
    python -m scripts.load_protocols data/sample/protocols.example.json --activate   # DEV ONLY

By default protocols are inserted INACTIVE / pending approval. --activate marks them
approved, which is an approval decision: never use it for protocols a flight surgeon has
not signed off on.
"""
import argparse
import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.core.database import engine, init_db
from app.countermeasure_engine.protocol_loader import load_protocols_file


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("file", type=Path)
    parser.add_argument("--activate", action="store_true", help="mark as approved + active (dev only)")
    args = parser.parse_args()

    init_db()
    with Session(engine) as db:
        summary = load_protocols_file(db, args.file, activate=args.activate)
    print(json.dumps(summary, indent=2))
    if args.activate:
        print("WARNING: protocols were activated without clinical approval. Development use only.")


if __name__ == "__main__":
    main()
