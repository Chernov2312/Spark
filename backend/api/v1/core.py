from fastapi import APIRouter

from config import RouteTags
from schemas.responses import HealthResponse

core_router = APIRouter(tags=[RouteTags.HEALTH_TEST])


@core_router.get("/health")
async def health_check() -> HealthResponse:
    return HealthResponse(status="healthy")
