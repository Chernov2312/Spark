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
    message_users_key = f"message:users:{message_id}"

    user_emoji = await redis.get(user_reaction_key)

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
    message_users_key = f"message:users:{message_id}"
    user_emoji = await redis.get(user_reaction_key)
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

    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=current_counters,
    )
