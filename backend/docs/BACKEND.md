# AstroVital Backend

FastAPI + SQLAlchemy 2.0 + SQLite backend for the astronaut health monitoring and decision-support prototype. It is a modular monolith: one process, one SQLite file, REST API under `/api/v1`.

> **Decision-support only.** Nothing here diagnoses or prescribes. Risk thresholds are general-population reference ranges, not NASA flight-surgeon limits, and the example countermeasure protocols are development placeholders (see [Known limitations](#known-limitations-and-decisions-needing-approval)).

## Setup

Requires Python 3.12+ (developed on 3.14).

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### Configuration

Settings come from environment variables or a local `.env` file (git-ignored). Copy [.env.example](../.env.example) to `.env` and adjust.

| Variable | Default | Purpose |
|---|---|---|
| `APP_NAME` | AstroVital Astronaut Health Companion | Title shown in Swagger |
| `DATABASE_URL` | `sqlite:///./data/astrovital.db` | SQLite file (created on first start) |
| `CORS_ORIGINS` | `["http://localhost:3000","http://127.0.0.1:3000"]` | Browser origins allowed to call the API (JSON list) |

### Run

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

- Swagger UI: http://localhost:8000/docs  ·  ReDoc: http://localhost:8000/redoc
- Tables and the 11 body regions are created automatically on startup (idempotent).

### Test

```powershell
.\.venv\Scripts\python.exe -m pytest -q
```

Every test uses its own temporary SQLite file (`tests/conftest.py`). Tests never touch `data/astrovital.db`.

## Architecture

```
request → api/v1/endpoints  (thin: parse, call, return)
        → services / <module>/*_service.py   (business logic, transactions)
        → repositories      (the only layer that queries SQLAlchemy)
        → models            (tables)
schemas/ = Pydantic request/response shapes
```

| Package | Responsibility |
|---|---|
| `app/core` | settings, database/session, domain errors, reference-data seed |
| `app/risk_engine` | tiered rule-based risk rules, pure calculator, explanations |
| `app/countermeasure_engine` | protocol matcher, safety checker, recommendation engine, protocol loader |
| `app/body_map` | symptom logging and per-region trends |
| `app/wellbeing` | wellbeing + cognitive assessments, concern flags, trends |
| `app/sync` | offline sync (idempotent push, conflict detection and resolution) |
| `app/ingestion` | CSV/JSON dataset import via mapping files |
| `scripts/` | command-line tools (below) |

The engines (`risk_calculator`, `recommendation_engine`, trend functions) are pure: data in, results out, no database access, so they are easy to test and replace.

### Conventions

- All timestamps are stored and returned in **UTC**. Naive input times are treated as UTC.
- Errors use FastAPI's standard shape `{"detail": ...}`: 404 not found, 409 conflict, 422 validation.
- List endpoints are paginated with `skip` and `limit`.
- Records created by an offline client carry a `client_uuid`. Re-sending the same one returns the stored record (200) instead of creating a duplicate (201).
- There is **no authentication** yet. Fields like `acknowledged_by` and `device_id` are self-reported.

## API reference (`/api/v1`)

| Area | Endpoints |
|---|---|
| System | `GET /health` |
| Astronauts | `POST /astronauts` · `GET /astronauts` · `GET /astronauts/{id}` · `PUT /astronauts/{id}` |
| Observations | `POST /observations` · `POST /observations/bulk` (≤500) · `GET /observations/{astronaut_id}` · `GET /observations/{astronaut_id}/latest` |
| Dashboard | `GET /dashboard/{id}/overview` · `GET /dashboard/{id}/trends?days=` (read-only) |
| Risk | `POST /risk/analyze/{id}` · `GET /risk/{id}` · `GET /risk/{id}/history` |
| Recommendations | `POST /recommendations/evaluate` · `GET /recommendations/{id}` · `GET /recommendations/protocols?active_only=` |
| Body map | `GET /body-map/regions` · `POST /body-map/symptoms` · `GET /body-map/{id}` · `GET /body-map/{id}/trends` |
| Wellbeing | `POST /wellbeing/assessment` · `GET /wellbeing/{id}` · `GET /wellbeing/{id}/trends` |
| Alerts | `GET /alerts/{id}` · `POST /alerts/{alert_id}/acknowledge` |
| Sync | `POST /sync/push` (≤200 events) · `GET /sync/status` · `POST /sync/conflicts/{id}/resolve` (extra) |

Swagger documents every request and response schema.

### Behaviour worth knowing

- **Observations**: all metrics optional but at least one required; physiological ranges reject typos and sensor garbage (these are data-entry limits, not clinical thresholds). The server computes `missing_fields` and `quality_score`.
- **Risk**: averages each metric over the last 72 h, fires tiered rules, and adds *combined* assessments when several categories fire together (e.g. poor sleep + high stress). Every assessment lists its contributing factors with rule, value, threshold, source and evidence label. Metrics with no data are reported in `not_evaluated`, never assumed normal. Medium-or-higher results raise alerts (no duplicate while one is open). Assessments with no concerns are not stored.
- **Recommendations**: use only protocols that are `is_active`, `approved` and have a source reference. Titles and descriptions are copied verbatim from the protocol. A text screen blocks protocols containing dosages or medication language. Red flags (critical risk, symptom severity ≥8, chest symptom ≥7) force escalation and `requires_medical_review`. Findings with no matching approved protocol return an escalation instruction instead of invented advice.
- **Wellbeing**: concern flags use neutral wording ("self-reported ...") and never diagnose. Cognitive scores are compared with the astronaut's own baseline (first 5 tests vs latest 3).
- **Dashboard**: never runs analysis. It shows stored results with their timestamps, and lists sources that have no data.
- **Sync**: each event commits on its own and gets its own result (`applied`, `duplicate`, `conflict`, `failed`). Conflicts (same `client_uuid` with different content, or a different record at the exact same timestamp) are stored for review and never overwrite or drop data. Resolve with `keep_server` or `accept_client`.

## Database

SQLite, created by `init_db()` (`Base.metadata.create_all`). No migration tool is used yet; if a model changes, delete the dev database (`data/astrovital.db`) or add Alembic.

| Group | Tables |
|---|---|
| People and data | `astronauts`, `datasets`, `observations` |
| Risk | `risk_assessments`, `risk_factors` |
| Recommendations | `countermeasure_protocols`, `countermeasure_recommendations` |
| Symptoms | `body_regions`, `symptom_reports` |
| Psychological | `wellbeing_assessments`, `cognitive_assessments` |
| ML (tables only) | `model_versions`, `predictions` |
| Alerts and sync | `alerts`, `sync_events`, `sync_conflicts` |

Key relationships: every record belongs to an `astronaut_id`; `risk_factors` → `risk_assessments`; `alerts` and `countermeasure_recommendations` reference the assessment that triggered them; `observations` reference a `dataset` and keep the original `source_record_id`; `cognitive_assessments` link to their `wellbeing_assessments` row; `sync_conflicts` → `sync_events`. Foreign keys are enforced (`PRAGMA foreign_keys=ON`), and the database runs in WAL mode.

Unique constraints that prevent duplicates: `client_uuid` (observations, symptoms, wellbeing, sync events), `(dataset_id, source_record_id)`, `datasets.file_hash`, `astronauts.crew_code`, `(protocol code, version)`.

## Command-line tools

Run from the project root.

**Load countermeasure protocols**

```powershell
.\.venv\Scripts\python.exe -m scripts.load_protocols data/sample/protocols.example.json
```

Protocols load **inactive and pending approval**. `--activate` marks them approved. That is an approval decision, so use it for local development only. Existing `(code, version)` rows are never modified; publish a change as a new version. The file in `data/sample/` holds *example* protocols written by the dev team. They are not NASA-approved.

**Import a dataset (CSV or JSON)**

```powershell
.\.venv\Scripts\python.exe -m scripts.import_dataset data/raw/file.csv --mapping data/mappings/file.json --dry-run
.\.venv\Scripts\python.exe -m scripts.import_dataset data/raw/file.csv --mapping data/mappings/file.json
```

Always `--dry-run` first. A mapping JSON file says which column becomes which observation field (with unit conversion), how to read the timestamp, and which column holds the subject and the original record id. See [data/sample/mapping.example.json](../data/sample/mapping.example.json) for the format. The rules:

- Times are never invented: a mapping without a timestamp column, or a row with an unparsable time, is rejected.
- Missing values stay missing. Nothing is imputed.
- The same file (by hash) cannot be imported twice, and a record id already imported under the same dataset name is skipped.
- The import is one transaction: any database error saves nothing. Bad rows are logged with their row number and record id, and do not stop the import.
- Imported subjects become inactive placeholder astronauts (mission `IMPORTED: <dataset>`), kept apart from real crew records.

## Known limitations and decisions needing approval

1. **Thresholds are not NASA-approved.** Risk rules use general-population references (AASM, ACC/AHA and similar). Each rule records its source and an `evidence` label (`guideline` or `convention`). Replace or confirm them with NASA or flight-surgeon sources in `app/risk_engine/rules.py`.
2. **Protocols are placeholders.** The seed file is for development. Real use needs flight-surgeon-approved protocols, and a decision on **who may approve a protocol**. There is no approval API; it is a database or script action.
3. **No authentication or authorization.** `acknowledged_by`, `device_id` and conflict resolution are unauthenticated. Add crew authorization before any real use.
4. **Convention-based cut-offs** for fatigue, stress and mood (7 and above, 3 and below) and the cognitive baseline rule (20% worse than the first 5 tests) are design choices. Use the instrument NASA actually uses.
5. **ML is not implemented.** Model training belongs to the ML teammate. The `model_versions` and `predictions` tables exist; a prediction interface will be designed once the model and feature format are agreed.
6. **All-clear risk runs are not stored.** The dashboard cannot tell "never analysed" from "analysed, no concerns". The response says so.
7. **Sync conflict detection is exact-match only** (same timestamp). Nearby timestamps are not treated as conflicts.
8. **Environment:** SQLAlchemy is pinned to **2.0.57**. On the development Windows machine, an Application Control policy blocks SQLAlchemy 2.1's compiled extensions, and also the `pandas` DLLs. `pandas` is in `requirements.txt` but is not used by any backend code. If it stays blocked, remove it or ask IT to allow it.
9. **Single SQLite file**, with sync SQLAlchemy sessions. This suits one onboard instance and a small crew, not many concurrent writers.
