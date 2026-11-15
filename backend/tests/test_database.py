from sqlalchemy import inspect, select

from app.core.database import init_db
from app.models import BodyRegion

EXPECTED_TABLES = {
    "astronauts", "datasets", "observations", "risk_assessments", "risk_factors",
    "countermeasure_protocols", "countermeasure_recommendations", "symptom_reports",
    "body_regions", "wellbeing_assessments", "cognitive_assessments", "predictions",
    "model_versions", "alerts", "sync_events", "sync_conflicts",
}


def test_all_tables_created(engine):
    assert EXPECTED_TABLES <= set(inspect(engine).get_table_names())


def test_init_db_is_idempotent_and_seeds_regions(engine, db_session):
    init_db(engine)  # second run must not fail or duplicate
    codes = list(db_session.scalars(select(BodyRegion.code)))
    assert len(codes) == len(set(codes))
    assert {"head", "chest", "lower_back"} <= set(codes)
