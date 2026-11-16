import asyncio
from collections.abc import Awaitable, Callable
import logging
import uuid

from redis.exceptions import RedisError

from infrastructure.redis.client import Redis

logger = logging.getLogger(__name__)


async def redis_pubsub_listener(
    chat_id: uuid.UUID,
    redis: Redis,
    send_event: Callable[[str], Awaitable[None]],
    ready_event: asyncio.Event | None = None,
) -> None:
    channel_key = f"chat:{chat_id}"
    pubsub = redis.pubsub()
    logger.info("Starting Redis pub/sub listener for chat %s", chat_id)
    try:
        await pubsub.subscribe(channel_key)
        logger.info("Subscribed to Redis channel %s", channel_key)
        if ready_event is not None:
            ready_event.set()
        async for message in pubsub.listen():
            if message.get("type") != "message":
                continue
            event_data = message.get("data")
            if isinstance(event_data, bytes):
                event_data = event_data.decode()
            if isinstance(event_data, str):
                await send_event(event_data)
    except RedisError:
        logger.exception("Redis pub/sub listener failed for channel %s", channel_key)
        raise
    finally:
        try:
            await pubsub.unsubscribe()
            await pubsub.aclose()
        except RedisError:
            logger.exception("Failed to close Redis pub/sub listener for %s", channel_key)
            raise
        logger.info("Stopped Redis pub/sub listener for channel %s", channel_key)
