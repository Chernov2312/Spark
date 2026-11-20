import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.security import get_id_current_user
from db.dao.push_subscription_dao import PushSubscriptionDao
from db.database import get_session
from schemas.push import PushConfigResponse, PushEndpoint, PushSubscriptionRequest

push_router = APIRouter(prefix="/api/v1/push", tags=["Web Push"])


@push_router.get("/config", dependencies=[Depends(get_id_current_user)])
async def get_push_config() -> PushConfigResponse:
    settings = get_settings()
    return PushConfigResponse(
        public_key=settings.WEB_PUSH_PUBLIC_KEY if settings.web_push_enabled else None
    )


@push_router.put("/subscription", status_code=status.HTTP_204_NO_CONTENT)
async def save_push_subscription(
    request: PushSubscriptionRequest,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    if not get_settings().web_push_enabled:
        raise HTTPException(status_code=503, detail="Web Push is not configured")
    if not await PushSubscriptionDao.upsert(session, user_id, request):
        raise HTTPException(
            status_code=409, detail="Push subscription already registered"
        )


@push_router.delete("/subscription", status_code=status.HTTP_204_NO_CONTENT)
async def delete_push_subscription(
    request: PushEndpoint,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await PushSubscriptionDao.remove(session, user_id, request.endpoint)
