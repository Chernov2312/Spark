from celery import Celery
from celery.schedules import crontab

from config import settings

CELERY_REDIS_URL = (
    f"redis://{settings.REDIS_USER}:{settings.REDIS_USER_PASSWORD}" f"@redis:6379/0"
)

celery_app = Celery("tasks", broker=CELERY_REDIS_URL)
celery_app.conf.beat_schedule = {
    "sync-reactions-every-5-minutes": {
        "task": "tasks.message_reactions.add_reactions_in_db",
        "schedule": crontab(minute="*"),
    },
}
celery_app.conf.update(
    include=[
        "tasks.email",
        "tasks.message_reactions",
    ],
)
