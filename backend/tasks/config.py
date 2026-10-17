import redis.asyncio as aioredis
from celery import Celery
from celery.schedules import crontab

from config import settings

CELERY_REDIS_URL = (
    f"redis://{settings.REDIS_USER}:{settings.REDIS_USER_PASSWORD}" f"@redis:6379/0"
)

celery_app = Celery("tasks", broker=CELERY_REDIS_URL)
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

redis = aioredis.Redis(
    host="redis",
    port=6379,
    username=settings.REDIS_USER,
    password=settings.REDIS_USER_PASSWORD,
    decode_responses=True,
)
