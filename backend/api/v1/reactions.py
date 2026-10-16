import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends

from config import RouteTags
from core.dependencies import get_redis
from core.security import get_id_current_user
from schemas.reactions import ReactionsRequest, ReactionsResponse

reactions_router = APIRouter(prefix="/api/v1/messages", tags=[RouteTags.REACTIONS])


@reactions_router.post("/{message_id}/reactions")
async def post_reactions(
    message_id: uuid.UUID,
    emoji: ReactionsRequest,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: aioredis.Redis = Depends(get_redis),
) -> ReactionsResponse:
    user_reaction_key = f"message:user_reaction:{message_id}:{user_id}"
    reactions_count_key = f"message:reactions_count:{message_id}"

    user_emoji = await redis.get(user_reaction_key)

    if user_emoji is None:
        await redis.hincrby(reactions_count_key, emoji.emoji, 1)
        await redis.set(user_reaction_key, emoji.emoji)

    elif user_emoji == emoji.emoji:
        new_count = await redis.hincrby(reactions_count_key, user_emoji, -1)
        await redis.delete(user_reaction_key)

        if new_count <= 0:
            await redis.hdel(reactions_count_key, user_emoji)

    else:
        new_old_count = await redis.hincrby(reactions_count_key, user_emoji, -1)
        await redis.hincrby(reactions_count_key, emoji.emoji, 1)
        await redis.set(user_reaction_key, emoji.emoji)

        if new_old_count <= 0:
            await redis.hdel(reactions_count_key, user_emoji)

    current_counters = await redis.hgetall(reactions_count_key)
    await redis.sadd("message:reactions:dirty_set", str(message_id))
    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=current_counters,
    )


@reactions_router.delete("/{message_id}/reactions")
async def delete(
    message_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: aioredis.Redis = Depends(get_redis),
) -> ReactionsResponse:
    user_reaction_key = f"message:user_reaction:{message_id}:{user_id}"
    reactions_count_key = f"message:reactions_count:{message_id}"
    user_emoji = await redis.get(user_reaction_key)
    if user_emoji is None:
        current_counters = await redis.hgetall(reactions_count_key)
        return ReactionsResponse(
            message_id=message_id, updated_reactions_count=current_counters,
        )
    else:
        await redis.delete(user_reaction_key)
        new_old_count = await redis.hincrby(reactions_count_key, user_emoji, -1)
        if new_old_count <= 0:
            await redis.hdel(reactions_count_key, user_emoji)
        current_counters = await redis.hgetall(reactions_count_key)
        await redis.sadd("message:reactions:dirty_set", str(message_id))
        return ReactionsResponse(
            message_id=message_id, updated_reactions_count=current_counters,
        )
