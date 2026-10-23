import redis.asyncio as aioredis
from celery import Celery
from celery.schedules import crontab

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

redis = aioredis.from_url(settings.redis_url)
