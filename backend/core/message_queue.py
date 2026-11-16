from datetime import datetime
import uuid

import redis.asyncio as aioredis

from schemas.message import MessageInternalDTO

MESSAGE_QUEUE_PREFIX = "messages:queue:"
HISTORY_CACHE_PREFIX = "messages:history:"
HISTORY_VERSION_PREFIX = "messages:history-version:"
HISTORY_CACHE_TTL_SECONDS = 600


def message_queue_key(chat_id: uuid.UUID | str) -> str:
    return f"{MESSAGE_QUEUE_PREFIX}{chat_id}"


def history_version_key(chat_id: uuid.UUID | str) -> str:
    return f"{HISTORY_VERSION_PREFIX}{chat_id}"


def history_cache_key(
    chat_id: uuid.UUID | str,
    user_id: uuid.UUID | str,
    limit: int,
    before: datetime | None,
    version: int,
) -> str:
    before_key = before.isoformat() if before else "latest"
    return f"{HISTORY_CACHE_PREFIX}{chat_id}:{user_id}:{limit}:{before_key}:{version}"


async def enqueue_message(
    redis: aioredis.Redis,
    message: MessageInternalDTO,
) -> None:
    async with redis.pipeline(transaction=True) as pipeline:
        pipeline.xadd(
            message_queue_key(message.chat_id),
            {"payload": message.model_dump_json()},
        )
        pipeline.set(
            f"message:chat:{message.id}",
            str(message.chat_id),
            ex=86_400,
        )
        pipeline.incr(history_version_key(message.chat_id))
        await pipeline.execute()


async def invalidate_chat_history(
    redis: aioredis.Redis,
    chat_id: uuid.UUID | str,
) -> None:
    await redis.incr(history_version_key(chat_id))
