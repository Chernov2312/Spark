from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
import logging
from typing import Any

import redis.asyncio as aioredis
from redis.asyncio.client import Pipeline
from redis.exceptions import RedisError

from config import get_settings

logger = logging.getLogger(__name__)


class Redis(aioredis.Redis):
    """Redis client that records command diagnostics without logging payloads."""

    async def execute_command(self, *args: Any, **options: Any) -> Any:
        command = str(args[0]).upper() if args else "UNKNOWN"
        try:
            result = await super().execute_command(*args, **options)
        except RedisError:
            logger.exception("Redis command failed: %s", command)
            raise
        logger.debug("Redis command completed: %s", command)
        return result


def create_redis_client(redis_url: str | None = None) -> Redis:
    client = Redis.from_url(
        redis_url or str(get_settings().redis_url),
        decode_responses=True,
    )
    logger.info("Redis client created")
    return client


async def close_redis_client(client: Redis) -> None:
    try:
        await client.aclose()
    except RedisError:
        logger.exception("Failed to close Redis client")
        raise
    logger.info("Redis client closed")


async def execute_redis_pipeline(
    pipeline: Pipeline,
    *,
    operation: str,
) -> list[Any]:
    try:
        result = await pipeline.execute()
    except RedisError:
        logger.exception("Redis pipeline failed: %s", operation)
        raise
    logger.debug("Redis pipeline completed: %s", operation)
    return result


@asynccontextmanager
async def get_redis() -> AsyncIterator[Redis]:
    client = create_redis_client()
    try:
        yield client
    finally:
        await close_redis_client(client)
