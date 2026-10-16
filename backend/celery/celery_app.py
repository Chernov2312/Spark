import redis.asyncio as aioredis
from celery import Celery
from config import settings
from core.dependencies import get_redis
from db.database import get_session
from db.dao.message_reactions_dao import MessageReaction

app = Celery("tasks", broker=settings.get_redis_client())


async def clear_redis():
    redis: aioredis.Redis = await get_redis()
    message_ids = dict()
    reactions_count_key = f"message:reactions_count:{message_id}"
    async for message_id in redis.sscan_iter("message:reactions:dirty_set"):
        message_ids[message_id] = redis.hget(reactions_count_key.format(message_id))
        redis.delete(reactions_count_key.format(message_id))


@app.task
def add(x, y):

    return x + y
