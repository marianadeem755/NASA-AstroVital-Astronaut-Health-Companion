"""Dataset ingestion. All data here is made up inside the tests; no NASA data is used."""
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.ingestion.errors import IngestionError
from app.ingestion.importer import IMPORTED_PREFIX, import_file
from app.ingestion.mapping import MappingSpec, load_mapping
from app.ingestion.normalizer import parse_timestamp
from app.models.astronaut import Astronaut
from app.models.dataset import Dataset
from app.models.observation import Observation

HEADER = "record_id,subject,measured_at,hr,sleep_min,device\n"
GOOD_ROWS = (
    "r1,S1,2025-01-01T08:00:00Z,72,420,watch\n"
    "r2,S1,2025-01-02T08:00:00Z,75,NA,watch\n"
    "r3,S2,2025-01-01T09:30:00Z,64,360,strap\n"
)


def spec(**overrides) -> MappingSpec:
    base = {
        "dataset_name": "test-set",
        "source": "unit test",
        "subject_field": "subject",
        "subject_prefix": "ext-",
        "record_id_field": "record_id",
        "timestamp": {"field": "measured_at"},
        "fields": {"heart_rate_bpm": {"source": "hr"},
                   "sleep_hours": {"source": "sleep_min", "scale": 1 / 60}},
        "extra": ["device"],
    }
    return MappingSpec.model_validate({**base, **overrides})


def csv_file(tmp_path: Path, body: str, name="data.csv") -> Path:
    path = tmp_path / name
    path.write_text(HEADER + body, encoding="utf-8")
    return path


def count(db, model):
    db.expire_all()
    return db.scalar(select(func.count()).select_from(model))


# ---------- happy path ----------

def test_csv_import_maps_units_extras_provenance_and_missing_values(db_session, tmp_path):
    r = import_file(db_session, csv_file(tmp_path, GOOD_ROWS), spec())
    assert (r.total_rows, r.imported, r.failed, r.persisted) == (3, 3, 0, True)

    ds = db_session.get(Dataset, r.dataset_id)
    assert ds.name == "test-set" and ds.format == "csv" and ds.records_imported == 3 and ds.imported_at
    assert len(ds.file_hash) == 64

    rows = {o.source_record_id: o for o in db_session.scalars(select(Observation))}
    assert rows["r1"].heart_rate_bpm == 72 and rows["r1"].sleep_hours == pytest.approx(7.0)
    assert rows["r1"].extra_metrics == {"device": "watch"}
    assert rows["r1"].dataset_id == ds.id
    # "NA" stays missing: never imputed, and recorded in the quality fields
    assert rows["r2"].sleep_hours is None and "sleep_hours" in rows["r2"].missing_fields
    assert rows["r2"].quality_score == pytest.approx(1 / 9, abs=0.001)


def test_subjects_become_flagged_inactive_placeholder_astronauts(db_session, tmp_path):
    r = import_file(db_session, csv_file(tmp_path, GOOD_ROWS), spec())
    assert sorted(r.created_astronauts) == ["ext-S1", "ext-S2"]
    for a in db_session.scalars(select(Astronaut)):
        assert a.is_active is False and a.mission_name == IMPORTED_PREFIX + "test-set"


def test_placeholder_astronauts_are_reused_across_imports(db_session, tmp_path):
    import_file(db_session, csv_file(tmp_path, GOOD_ROWS), spec())
    more = csv_file(tmp_path, "r9,S1,2025-02-01T08:00:00Z,70,400,watch\n", "more.csv")
    r = import_file(db_session, more, spec())
    assert r.created_astronauts == [] and count(db_session, Astronaut) == 2


def test_csv_quirks_bom_and_thousands_separators(db_session, tmp_path):
    path = tmp_path / "bom.csv"
    path.write_bytes(("﻿" + HEADER + 'r1,S1,2025-01-01T08:00:00Z,"1,234",NA,x\n').encode("utf-8"))
    r = import_file(db_session, path, spec(fields={"sleep_hours": {"source": "hr", "scale": 0.001}}))
    assert r.imported == 1  # 1,234 -> 1234 * 0.001 = 1.234 h


def test_json_list_and_records_path(db_session, tmp_path):
    rows = [{"record_id": "j1", "subject": "S1", "measured_at": "2025-01-01T08:00:00Z", "hr": 70}]
    plain = tmp_path / "a.json"
    plain.write_text(json.dumps(rows))
    assert import_file(db_session, plain, spec(extra=[])).imported == 1

    nested = tmp_path / "b.json"
    nested.write_text(json.dumps({"data": {"records": [{**rows[0], "record_id": "j2", "vitals": {"hr": 80}}]}}))
    m = spec(extra=[], records_path="data.records", fields={"heart_rate_bpm": {"source": "vitals.hr"}})
    assert import_file(db_session, nested, m).imported == 1
    assert db_session.scalar(select(Observation.heart_rate_bpm).where(Observation.source_record_id == "j2")) == 80


# ---------- invalid rows ----------

def test_invalid_rows_are_logged_and_skipped_without_aborting(db_session, tmp_path):
    body = (
        "ok1,S1,2025-01-01T08:00:00Z,72,420,w\n"
        "bad1,S1,2025-01-01T09:00:00Z,5,420,w\n"        # hr out of range
        "bad2,S1,not-a-date,70,420,w\n"                  # bad timestamp
        "bad3,S1,2025-01-01T10:00:00Z,abc,420,w\n"       # not a number
        ",S1,2025-01-01T11:00:00Z,70,420,w\n"            # missing record id
        "bad5,,2025-01-01T12:00:00Z,70,420,w\n"          # missing subject
        "bad6,S1,2025-01-01T13:00:00Z,NA,NA,w\n"         # no metrics at all (only extra)
        "ok2,S1,2025-01-01T14:00:00Z,70,420,w\n"
    )
    r = import_file(db_session, csv_file(tmp_path, body), spec(extra=[]))
    assert (r.total_rows, r.imported, r.failed) == (8, 2, 6)
    assert {e["row"]: e["record_id"] for e in r.errors if e["row"] in (2, 3, 4)} == {2: "bad1", 3: "bad2", 4: "bad3"}
    errors = {e["row"]: e["error"] for e in r.errors}
    assert "heart_rate_bpm" in errors[2] and "timestamp" in errors[3] and "not a number" in errors[4]
    assert "record id" in errors[5] and "subject" in errors[6] and set(errors) == {2, 3, 4, 5, 6, 7}
    ds = db_session.get(Dataset, r.dataset_id)
    assert ds.records_failed == 6 and len(ds.import_errors) == 6  # error log is stored


def test_duplicate_record_id_inside_a_file_is_an_error(db_session, tmp_path):
    body = "r1,S1,2025-01-01T08:00:00Z,72,420,w\nr1,S1,2025-01-01T09:00:00Z,73,420,w\n"
    r = import_file(db_session, csv_file(tmp_path, body), spec())
    assert (r.imported, r.failed) == (1, 1) and "duplicate record id" in r.errors[0]["error"]


def test_future_timestamps_are_rejected_like_the_api(db_session, tmp_path):
    r = import_file(db_session, csv_file(tmp_path, "r1,S1,2999-01-01T00:00:00Z,72,420,w\n"), spec())
    assert r.imported == 0 and r.failed == 1


def test_subject_colliding_with_a_real_astronaut_is_refused_per_row(db_session, tmp_path):
    db_session.add(Astronaut(crew_code="ext-S1", full_name="Real Crew Member"))
    db_session.commit()
    body = "r1,S1,2025-01-01T08:00:00Z,72,420,w\nr2,S2,2025-01-01T08:00:00Z,72,420,w\n"
    r = import_file(db_session, csv_file(tmp_path, body), spec())
    assert (r.imported, r.failed) == (1, 1) and "non-imported astronaut" in r.errors[0]["error"]
    real = db_session.scalar(select(Astronaut).where(Astronaut.crew_code == "ext-S1"))
    assert count(db_session, Observation) == 1
    assert db_session.scalar(select(func.count()).select_from(Observation).where(Observation.astronaut_id == real.id)) == 0


def test_rows_without_a_record_id_column_use_row_numbers(db_session, tmp_path):
    r = import_file(db_session, csv_file(tmp_path, GOOD_ROWS), spec(record_id_field=None))
    assert r.imported == 3
    assert {o.source_record_id for o in db_session.scalars(select(Observation))} == {"row-1", "row-2", "row-3"}


# ---------- duplicate protection ----------

def test_same_file_cannot_be_imported_twice(db_session, tmp_path):
    path = csv_file(tmp_path, GOOD_ROWS)
    import_file(db_session, path, spec())
    again = import_file(db_session, path, spec())
    assert again.refused_reason and "already imported" in again.refused_reason and not again.persisted
    assert count(db_session, Observation) == 3 and count(db_session, Dataset) == 1


def test_overlapping_records_from_a_new_file_of_the_same_dataset_are_skipped(db_session, tmp_path):
    import_file(db_session, csv_file(tmp_path, GOOD_ROWS), spec())
    newer = csv_file(tmp_path, GOOD_ROWS + "r4,S1,2025-01-03T08:00:00Z,70,400,w\n", "v2.csv")
    r = import_file(db_session, newer, spec())
    assert (r.imported, r.skipped_existing) == (1, 3)
    assert count(db_session, Observation) == 4


def test_same_record_ids_under_a_different_dataset_name_are_independent(db_session, tmp_path):
    import_file(db_session, csv_file(tmp_path, GOOD_ROWS), spec())
    other = csv_file(tmp_path, GOOD_ROWS, "copy.csv")
    other.write_text(HEADER + GOOD_ROWS + "# changed\n", encoding="utf-8")  # different hash
    r = import_file(db_session, other, spec(dataset_name="another-set", subject_prefix="b-"))
    assert r.imported == 3 and count(db_session, Observation) == 6


# ---------- dry run and atomicity ----------

def test_dry_run_reports_everything_but_writes_nothing(db_session, tmp_path):
    r = import_file(db_session, csv_file(tmp_path, GOOD_ROWS + "bad,S3,x,70,1,w\n"), spec(), dry_run=True)
    assert (r.total_rows, r.imported, r.failed, r.persisted, r.dry_run) == (4, 3, 1, False, True)
    assert sorted(r.created_astronauts) == ["ext-S1", "ext-S2"]
    assert count(db_session, Dataset) == count(db_session, Observation) == count(db_session, Astronaut) == 0


def test_import_with_no_valid_rows_saves_nothing_and_can_be_retried(db_session, tmp_path):
    path = csv_file(tmp_path, "r1,S1,not-a-date,72,420,w\n")
    r = import_file(db_session, path, spec())
    assert not r.persisted and r.refused_reason and "No valid rows" in r.refused_reason
    assert count(db_session, Dataset) == count(db_session, Astronaut) == 0
    # fixing the mapping and retrying the SAME file works (it was never registered)
    fixed = spec(timestamp={"field": "measured_at", "format": "strptime:%d/%m/%Y"})
    path.write_text(HEADER + "r1,S1,01/02/2025,72,420,w\n", encoding="utf-8")
    assert import_file(db_session, path, fixed).imported == 1


def test_database_failure_rolls_everything_back(db_session, tmp_path, monkeypatch):
    from app.ingestion import importer

    calls = {"n": 0}
    real_build = importer.observation_repo.build

    def exploding_build(data):
        calls["n"] += 1
        if calls["n"] == 3:
            raise RuntimeError("disk error")
        return real_build(data)

    monkeypatch.setattr(importer.observation_repo, "build", exploding_build)
    with pytest.raises(IngestionError, match="rolled back"):
        import_file(db_session, csv_file(tmp_path, GOOD_ROWS), spec())
    assert count(db_session, Dataset) == count(db_session, Observation) == count(db_session, Astronaut) == 0


# ---------- timestamps ----------

@pytest.mark.parametrize(
    "fmt, tz, value, expected",
    [
        ("iso", "UTC", "2025-01-01T08:00:00", "2025-01-01T08:00:00+00:00"),
        ("iso", "+02:00", "2025-01-01T08:00:00", "2025-01-01T06:00:00+00:00"),  # offset applied to naive
        ("iso", "+02:00", "2025-01-01T08:00:00Z", "2025-01-01T08:00:00+00:00"),  # explicit zone wins
        ("epoch_s", "UTC", "1735718400", "2025-01-01T08:00:00+00:00"),
        ("epoch_ms", "UTC", "1735718400000", "2025-01-01T08:00:00+00:00"),
        ("strptime:%d/%m/%Y %H:%M", "-05:00", "01/01/2025 03:00", "2025-01-01T08:00:00+00:00"),
    ],
)
def test_timestamp_formats_and_timezones(fmt, tz, value, expected):
    ts = spec(timestamp={"field": "t", "format": fmt, "timezone": tz}).timestamp
    assert parse_timestamp(value, ts).isoformat() == expected


# ---------- mapping + reader validation ----------

@pytest.mark.parametrize(
    "bad",
    [
        {"fields": {"blood_type": {"source": "x"}}},                       # unknown target field
        {"fields": {}, "extra": []},                                       # nothing to import
        {"timestamp": {"field": "t", "timezone": "Europe/Paris"}},         # only UTC / fixed offsets
        {"timestamp": {"field": "t", "format": "dd-mm-yyyy"}},
        {"timestamp": None},                                               # times are never invented
        {"subject_field": ""},
    ],
)
def test_invalid_mappings_are_rejected(bad):
    base = {"dataset_name": "x", "subject_field": "s", "timestamp": {"field": "t"}, "fields": {"heart_rate_bpm": {"source": "h"}}}
    with pytest.raises(Exception):
        MappingSpec.model_validate({**base, **bad})


def test_load_mapping_file_ignores_underscore_notes_and_reports_errors(tmp_path):
    path = tmp_path / "m.json"
    path.write_text(json.dumps({"_notice": "hi", "dataset_name": "x", "subject_field": "s",
                                "timestamp": {"field": "t"}, "fields": {"heart_rate_bpm": {"source": "h"}}}))
    assert load_mapping(path).dataset_name == "x"
    path.write_text("{not json")
    with pytest.raises(IngestionError, match="not valid JSON"):
        load_mapping(path)
    path.write_text(json.dumps({"dataset_name": "x"}))
    with pytest.raises(IngestionError, match="Invalid mapping"):
        load_mapping(path)
    with pytest.raises(IngestionError, match="not found"):
        load_mapping(tmp_path / "missing.json")


def test_shipped_example_mapping_is_valid():
    example = Path(__file__).parent.parent / "data" / "sample" / "mapping.example.json"
    assert load_mapping(example).timestamp.field == "measured_at"


@pytest.mark.parametrize(
    "name, content, message",
    [
        ("empty.csv", "", "no header"),
        ("bad.json", "{oops", "Malformed JSON"),
        ("obj.json", '{"a": 1}', "list of records"),
        ("data.xlsx", "x", "Unsupported file type"),
    ],
)
def test_unreadable_files_are_rejected_before_anything_is_written(db_session, tmp_path, name, content, message):
    path = tmp_path / name
    path.write_text(content)
    with pytest.raises(IngestionError, match=message):
        import_file(db_session, path, spec())
    assert count(db_session, Dataset) == count(db_session, Astronaut) == 0


def test_missing_file_is_rejected(db_session, tmp_path):
    with pytest.raises(IngestionError, match="not found"):
        import_file(db_session, tmp_path / "nope.csv", spec())


def test_json_with_non_object_rows_reports_them_per_row(db_session, tmp_path):
    path = tmp_path / "mixed.json"
    path.write_text(json.dumps(["oops", {"record_id": "a", "subject": "S", "measured_at": "2025-01-01T00:00:00Z", "hr": 70}]))
    r = import_file(db_session, path, spec(extra=[]))
    assert (r.imported, r.failed) == (1, 1) and "not an object" in r.errors[0]["error"]
