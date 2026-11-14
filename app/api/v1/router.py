from fastapi import APIRouter

from app.api.v1.endpoints import astronauts, body_map, health, observations, recommendations, risk

api_router = APIRouter()

api_router.include_router(health.router)
api_router.include_router(astronauts.router)
api_router.include_router(observations.router)
api_router.include_router(risk.router)
api_router.include_router(recommendations.router)
api_router.include_router(body_map.router)
