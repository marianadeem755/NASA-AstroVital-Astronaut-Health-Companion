"""Database engine, session factory and initialisation.

Concepts:
- Engine: the connection to the SQLite file.
- Session: a unit of work (a transaction). One session per HTTP request.
- get_db(): FastAPI dependency that opens a session and always closes it.
"""
from collections.abc import Generator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine, make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings


def _ensure_sqlite_dir(url: str) -> None:
    parsed = make_url(url)
    if parsed.drivername.startswith("sqlite") and parsed.database not in (None, ":memory:"):
        Path(parsed.database).parent.mkdir(parents=True, exist_ok=True)


def make_engine(url: str) -> Engine:
    _ensure_sqlite_dir(url)
    # check_same_thread=False: FastAPI may use a session from a worker thread.
    eng = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(eng, "connect")
    def _sqlite_pragmas(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")  # SQLite ignores FKs unless enabled
        cur.execute("PRAGMA journal_mode=WAL")  # better read/write concurrency
        cur.close()

    return eng


engine = make_engine(settings.database_url)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db(bind: Engine | None = None) -> None:
    """Create all tables (idempotent) and seed static reference data."""
    from app.core.seed import seed_body_regions
    from app.models import Base  # importing registers every model

    target = bind or engine
    Base.metadata.create_all(bind=target)
    with Session(target) as session:
        seed_body_regions(session)
        session.commit()
