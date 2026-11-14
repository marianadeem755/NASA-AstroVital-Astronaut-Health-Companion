from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.database import init_db
from app.core.exceptions import register_exception_handlers
from app.ml import predict


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()  # create tables on startup (idempotent)
    predict.load_models()  # load the trained .pkl files once (missing files are reported by GET /ml/status)
    yield


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

# Allow the Next.js frontend (different origin) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

register_exception_handlers(app)
app.include_router(api_router, prefix=settings.api_v1_prefix)


@app.get("/", tags=["System"])
def root():
    """Home page of the API: shows that the server is running and where to look next."""
    prefix = settings.api_v1_prefix
    return {
        "app": settings.app_name,
        "version": settings.app_version,
        "status": "running",
        "docs": "/docs",
        "health": f"{prefix}/health",
        "ml_status": f"{prefix}/ml/status",
        "ml_scenarios": f"{prefix}/ml/scenarios",
        "ml_check_day_example": f"{prefix}/ml/check-day?scenario_id=B_R%2B1_bad_day",
        "ml_recommendations_example": f"{prefix}/ml/recommendations?scenario_id=B_R%2B1_bad_day",
    }