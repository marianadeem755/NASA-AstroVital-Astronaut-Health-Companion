"""Shared fixtures. Every test gets its own throwaway SQLite file,
so tests never touch data/astrovital.db."""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import sessionmaker

from app.core.database import get_db, init_db, make_engine
from app.main import app


@pytest.fixture()
def engine(tmp_path):
    eng = make_engine(f"sqlite:///{tmp_path / 'test.db'}")
    init_db(eng)
    yield eng
    eng.dispose()


@pytest.fixture()
def db_session(engine):
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with Session() as session:
        yield session


@pytest.fixture()
def client(engine):
    Session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db():
        db = Session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    # No `with`: skips the lifespan, which would call init_db on the real database.
    yield TestClient(app)
    app.dependency_overrides.clear()
