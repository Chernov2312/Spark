import uuid

import redis.asyncio as aioredis
from celery import Celery

from config import settings
from core.dependencies import get_redis
from db.database import get_session

app = Celery("tasks", broker=settings.get_redis_client())


async def clear_redis() -> (
    dict[uuid.UUID, dict[str, dict[uuid.UUID, str] | dict[str, int]]]
):
    redis: aioredis.Redis = await get_redis()
    message_ids = [
        msg_id async for msg_id in redis.sscan_iter("message:reactions:dirty_set")
    ]
    if not message_ids:
        return {}
    result_data = {}
    async with redis.pipeline(transaction=False) as pipe:
        for message in message_ids:
            reactions_count_key = f"message:reactions_count:{message}"
            message_users_key = f"message:users:{message}"
            pipe.hgetall(reactions_count_key)
            pipe.smembers(message_users_key)
        responses = await pipe.execute()
    async with redis.pipeline(transaction=False) as pipe:
        for ind, message_id in enumerate(message_ids):
            reactions_count_key = f"message:reactions_count:{message}"
            message_users_key = f"message:users:{message}"
            reactions = responses[ind * 2]
            users = responses[ind * 2 + 1]
            reactions_clean = {k: int(v) for k, v in reactions.items() if int(v) > 0}
            result_data[message_id] = {"reactions": reactions_clean, "users": {}}
            for user_id in users:
                user_reaction_key = f"message:user_reaction:{message_id}:{user_id}"
                pipe.smembers(user_reaction_key)
                pipe.delete(user_reaction_key)

            pipe.delete(reactions_count_key)
            pipe.delete(message_users_key)

        user_emoji_results = await pipe.execute()
    emoji_index = 0
    for msg_id in message_ids:
        user_ids = list(responses[message_ids.index(msg_id) * 2 + 1])
        for u_id in user_ids:
            emoji = user_emoji_results[emoji_index]
            if emoji:
                result_data[msg_id]["users"][u_id] = emoji
            emoji_index += 1
    return result_data


@app.task
def add(x, y):

    return x + y
