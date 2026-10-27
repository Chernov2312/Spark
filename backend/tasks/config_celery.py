import redis.asyncio as aioredis
from celery import Celery
from celery.schedules import crontab
from contextlib import asynccontextmanager
from config import settings

celery_app = Celery("tasks", broker=settings.redis_url)
celery_app.conf.beat_schedule = {
    "sync-reactions-every-1-minutes": {
        "task": "tasks.scheduler.master_sync_scheduler",
        "schedule": crontab(minute="*"),
    },
}
celery_app.conf.update(
    include=[
        "tasks.email",
        "tasks.message",
        "tasks.message_reactions",
        "tasks.scheduler",
    ],
)
@asynccontextmanager
async def get_redis():
    client = aioredis.Redis.from_url(settings.redis_url, decode_responses=True)
    try:
        yield client
    finally:
        await client.aclose()