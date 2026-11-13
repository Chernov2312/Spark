import asyncio
import uuid
from typing import TypedDict

from tasks.config_celery import celery_app, get_redis, run_async_task

from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao
from db.database import async_session_maker


class MessageReactionData(TypedDict):
    id: uuid.UUID
    users: dict[uuid.UUID, str]
    reactions_count: dict[str, int]


async def clear_redis() -> list[MessageReactionData]:
    async with get_redis() as redis:
        message_ids = await redis.spop("message:reactions:dirty_set", count=1000)
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
                users = responses[ind * 2 + 1]
                for user_id in users:
                    pipe.get(f"message:user_reaction:{message_id}:{user_id}")

            user_emoji_results = await pipe.execute()

        async with redis.pipeline(transaction=False) as pipe:
            for ind, message_id in enumerate(message_ids):
                users = responses[ind * 2 + 1]
                for user_id in users:
                    pipe.delete(f"message:user_reaction:{message_id}:{user_id}")
                pipe.delete(f"message:reactions_count:{message_id}")
                pipe.delete(f"message:users:{message_id}")
            await pipe.execute()
        emoji_total_index = 0

        for ind, message_id in enumerate(message_ids):
            reactions = responses[ind * 2]
            users = responses[ind * 2 + 1]

            reactions_clean = {k: int(v) for k, v in reactions.items() if int(v) > 0}
            result_data[message_id] = {"reactions": reactions_clean, "users": {}}

            for user_id in users:
                emoji_data = user_emoji_results[emoji_total_index]
                emoji_total_index += 1  #
                if emoji_data:
                    emoji = (
                        list(emoji_data)[0]
                        if isinstance(emoji_data, (set, list))
                        else emoji_data
                    )
                    result_data[message_id]["users"][user_id] = emoji
        res = []
        for msg_id, data in result_data.items():
            res.append(
                {
                    "id": uuid.UUID(str(msg_id)),
                    "users": data["users"],
                    "reactions_count": data["reactions"],
                },
            )
        return res


async def sync_reactions_task_core():
    try:
        while True:
            async with async_session_maker() as session:
                reactions = await clear_redis()

                if not reactions:
                    break
                async with session.begin():
                    await MessageDao.update_msg_reactions_by_ids(
                        session=session,
                        message_reactions=reactions,
                    )
                    await MessageReactionDao.update_user_reactions(
                        session=session,
                        message_reactions=reactions,
                    )
    except Exception:
        pass


@celery_app.task(ignore_result=True)
def add_reactions_in_db():
    asyncio.run(run_async_task(sync_reactions_task_core()))
