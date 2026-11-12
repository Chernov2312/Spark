from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from celery import Celery
from celery.schedules import crontab

from config import settings

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


@asynccontextmanager
async def get_redis():
    client = aioredis.Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        yield client
    finally:
        await client.aclose()
