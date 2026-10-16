import asyncio
import uuid
from typing import TypedDict

import redis.asyncio as aioredis
from celery import Celery
from celery.schedules import crontab

from config import settings
from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao
from db.database import get_session

CELERY_REDIS_URL = (
    f"redis://{settings.REDIS_USER}:{settings.REDIS_USER_PASSWORD}" f"@redis:6379/0"
)

app = Celery("sync_db", broker=CELERY_REDIS_URL)
app.conf.beat_schedule = {
    "sync-reactions-every-5-minutes": {
        "task": "worker.sync_db.add_reactions_in_db",
        "schedule": crontab(minute="*"),
    },
}


class MessageReactionData(TypedDict):
    id: uuid.UUID
    users: dict[uuid.UUID, str]
    reactions_count: dict[str, int]


async def clear_redis() -> list[MessageReactionData]:
    redis = aioredis.Redis(
        host="redis",
        port=6379,
        username=settings.REDIS_USER,
        password=settings.REDIS_USER_PASSWORD,
        decode_responses=True,
    )

    async with redis:
        message_ids = [
            msg_id async for msg_id in redis.sscan_iter("message:reactions:dirty_set")
        ]
        if not message_ids:
            return []

        result_data = {}

        async with redis.pipeline(transaction=False) as pipe:
            for message in message_ids:
                pipe.hgetall(f"message:reactions_count:{message}")
                pipe.smembers(f"message:users:{message}")
            responses = await pipe.execute()

        async with redis.pipeline(transaction=False) as pipe:
            for ind, message_id in enumerate(message_ids):
                reactions = responses[ind * 2]
                users = responses[ind * 2 + 1]

                reactions_clean = {k: int(v) for k, v in reactions.items() if int(v) > 0}
                result_data[message_id] = {"reactions": reactions_clean, "users": {}}

                for user_id in users:
                    user_reaction_key = f"message:user_reaction:{message_id}:{user_id}"
                    pipe.smembers(user_reaction_key)
                    pipe.delete(user_reaction_key)

                pipe.delete(f"message:reactions_count:{message_id}")
                pipe.delete(f"message:users:{message_id}")

            user_emoji_results = await pipe.execute()

        emoji_index = 0
        for ind, msg_id in enumerate(message_ids):
            users = responses[ind * 2 + 1]
            for u_id in users:
                emoji_data = user_emoji_results[emoji_index]
                if emoji_data:
                    emoji = (
                        list(emoji_data)[0]
                        if isinstance(emoji_data, (set, list))
                        else emoji_data
                    )
                    result_data[msg_id]["users"][u_id] = emoji
                emoji_index += 2
        res = []
        for msg_id, data in result_data.items():
            res.append(
                {
                    "id": msg_id,
                    "users": data["users"],
                    "reactions_count": data["reactions"],
                },
            )
    return res


async def sync_reactions_task_core():
    reactions = await clear_redis()
    if not reactions:
        return

    session = await get_session()
    await MessageDao.update_msg_reactions_by_ids(
        session=session,
        message_reactions=reactions,
    )
    await MessageReactionDao.update_user_reactions(
        session=session,
        message_reactions=reactions,
    )
    await session.commit()


@app.task(ignore_result=True)
def add_reactions_in_db():
    asyncio.run(sync_reactions_task_core())
