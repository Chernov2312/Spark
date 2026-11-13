from contextlib import asynccontextmanager
from typing import Awaitable, TypeVar

import redis.asyncio as aioredis
from celery import Celery
from celery.schedules import crontab
from celery.signals import worker_process_init

from config import settings
from db.database import engine

T = TypeVar("T")

celery_app = Celery("tasks", broker=settings.redis_url)
celery_app.conf.beat_schedule = {
    "sync-reactions-every-1-minutes": {
        "task": "tasks.message_reactions.add_reactions_in_db",
        "schedule": crontab(minute="*"),
    },
    "sync-messages-every-2-minutes": {
        "task": "tasks.message.add_messages_in_db",
        "schedule": crontab(minute="*/2"),
    },
}
celery_app.conf.update(
    include=[
        "tasks.email",
        "tasks.message",
        "tasks.message_reactions",
        "tasks.scheduler",
        "tasks.audio_convert",
    ],
)


@worker_process_init.connect
def reset_database_pool_after_fork(**_kwargs) -> None:
    # Celery forks workers after importing the app. Do not let child processes
    # reuse asyncpg connections inherited from the parent process.
    engine.sync_engine.dispose(close=False)


async def run_async_task(coroutine: Awaitable[T]) -> T:
    """Run one async Celery task and discard loop-bound pooled connections."""
    try:
        return await coroutine
    finally:
        # Celery's sync task wrapper creates a fresh event loop for every call.
        # AsyncEngine connections must not be reused by a later loop.
        await engine.dispose()


@asynccontextmanager
async def get_redis():
    client = aioredis.Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        yield client
    finally:
        await client.aclose()
