from fastapi import APIRouter

from app.api.v1.endpoints import alerts, astronauts, body_map, dashboard, exercise, health, ml, observations, recommendations, risk, sync, wellbeing

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(astronauts.router)
api_router.include_router(observations.router)
api_router.include_router(risk.router)
api_router.include_router(recommendations.router)
api_router.include_router(body_map.router)
api_router.include_router(alerts.router)
api_router.include_router(wellbeing.router)
api_router.include_router(exercise.router)
api_router.include_router(dashboard.router)
api_router.include_router(sync.router)
api_router.include_router(ml.router)
