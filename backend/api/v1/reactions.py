import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.dependencies import get_redis
from core.security import get_id_current_user
from db.dao.message_dao import MessageDao
from db.database import get_session
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.reactions import ReactionsRequest, ReactionsResponse

reactions_router = APIRouter(prefix="/api/v1/messages", tags=[RouteTags.REACTIONS])


@reactions_router.post("/{message_id}/reactions")
async def post_reactions(
    message_id: uuid.UUID,
    emoji: ReactionsRequest,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
    session: AsyncSession = Depends(get_session),
) -> ReactionsResponse:
    chat_id = await RedisDao.get_message_chat_id(redis, message_id)
    if chat_id is None:
        chat_id = await MessageDao.get_chat_id_by_message(session, message_id)
    current_counters = await RedisDao.set_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
        emoji=emoji.emoji,
    )
    await RedisDao.invalidate_history_for_message(redis, message_id, chat_id)
    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=current_counters,
    )


@reactions_router.delete("/{message_id}/reactions")
async def delete(
    message_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
    session: AsyncSession = Depends(get_session),
) -> ReactionsResponse:
    chat_id = await RedisDao.get_message_chat_id(redis, message_id)
    if chat_id is None:
        chat_id = await MessageDao.get_chat_id_by_message(session, message_id)
    current_counters, removed = await RedisDao.remove_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
    )
    if removed:
        await RedisDao.invalidate_history_for_message(redis, message_id, chat_id)

    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=current_counters,
    )
