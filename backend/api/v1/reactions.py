import uuid

from fastapi import APIRouter, Depends
import redis.asyncio as aioredis
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.dependencies import get_redis
from core.message_queue import invalidate_chat_history
from core.security import get_id_current_user
from db.dao.message_dao import MessageDao
from db.database import get_session
from schemas.reactions import ReactionsRequest, ReactionsResponse

reactions_router = APIRouter(prefix="/api/v1/messages", tags=[RouteTags.REACTIONS])


@reactions_router.post("/{message_id}/reactions")
async def post_reactions(
    message_id: uuid.UUID,
    emoji: ReactionsRequest,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: aioredis.Redis = Depends(get_redis),
    session: AsyncSession = Depends(get_session),
) -> ReactionsResponse:
    user_reaction_key = f"message:user_reaction:{message_id}:{user_id}"
    reactions_count_key = f"message:reactions_count:{message_id}"
    message_users_key = f"message:users:{message_id}"

    user_emoji = await redis.get(user_reaction_key)
    chat_id = await redis.get(f"message:chat:{message_id}")
    if chat_id is None:
        chat_id = await MessageDao.get_chat_id_by_message(session, message_id)

    async with redis.pipeline(transaction=True) as pipe:
        if user_emoji is None:
            pipe.hincrby(reactions_count_key, emoji.emoji, 1)
            pipe.set(user_reaction_key, emoji.emoji)
            pipe.sadd(message_users_key, str(user_id))

        elif user_emoji == emoji.emoji:
            pipe.hincrby(reactions_count_key, user_emoji, -1)
            pipe.delete(user_reaction_key)
            pipe.srem(message_users_key, str(user_id))

        else:
            pipe.hincrby(reactions_count_key, user_emoji, -1)
            pipe.hincrby(reactions_count_key, emoji.emoji, 1)
            pipe.set(user_reaction_key, emoji.emoji)

        pipe.hgetall(reactions_count_key)
        pipe.sadd("message:reactions:dirty_set", str(message_id))

        results = await pipe.execute()
        current_counters = results[-2]
    if chat_id is not None:
        await invalidate_chat_history(redis, chat_id)
    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=current_counters,
    )


@reactions_router.delete("/{message_id}/reactions")
async def delete(
    message_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: aioredis.Redis = Depends(get_redis),
    session: AsyncSession = Depends(get_session),
) -> ReactionsResponse:
    user_reaction_key = f"message:user_reaction:{message_id}:{user_id}"
    reactions_count_key = f"message:reactions_count:{message_id}"
    message_users_key = f"message:users:{message_id}"
    user_emoji = await redis.get(user_reaction_key)
    chat_id = await redis.get(f"message:chat:{message_id}")
    if chat_id is None:
        chat_id = await MessageDao.get_chat_id_by_message(session, message_id)
    if user_emoji is None:
        current_counters = await redis.hgetall(reactions_count_key)
        return ReactionsResponse(
            message_id=message_id,
            updated_reactions_count=current_counters,
        )

    async with redis.pipeline(transaction=True) as pipe:
        pipe.delete(user_reaction_key)
        pipe.srem(message_users_key, str(user_id))
        pipe.hincrby(reactions_count_key, user_emoji, -1)
        pipe.hgetall(reactions_count_key)
        pipe.sadd("message:reactions:dirty_set", str(message_id))

        results = await pipe.execute()
        current_counters = results[-2]
    if chat_id is not None:
        await invalidate_chat_history(redis, chat_id)

    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=current_counters,
    )
