import asyncio
import logging
import uuid

from kombu.exceptions import KombuError

from core.link_preview import fetch_link_preview
from infrastructure.redis.client import get_redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.websockets import MessageLinkPreview, WsEvent
from tasks.config_celery import celery_app

logger = logging.getLogger(__name__)


async def publish_link_preview(
    chat_id: uuid.UUID, message_id: uuid.UUID, url: str
) -> None:
    async with get_redis() as redis:
        preview = await RedisDao.get_link_preview(redis, chat_id, message_id, url)
        if preview is None:
            preview = await fetch_link_preview(url)
            if preview is None:
                return
            await RedisDao.cache_link_preview(redis, chat_id, message_id, preview)
        event = WsEvent(
            event="message:link-preview",
            data=MessageLinkPreview(
                chat_id=chat_id, message_id=message_id, preview=preview
            ),
        )
        await RedisDao.publish_chat_event(redis, chat_id, event.model_dump_json())


@celery_app.task(ignore_result=True)
def parse_link_preview_task(chat_id: str, message_id: str, url: str) -> None:
    asyncio.run(publish_link_preview(uuid.UUID(chat_id), uuid.UUID(message_id), url))


async def enqueue_link_preview(
    chat_id: uuid.UUID, message_id: uuid.UUID, url: str | None
) -> None:
    if url is None:
        return
    try:
        await asyncio.to_thread(
            parse_link_preview_task.apply_async,
            args=(str(chat_id), str(message_id), url),
            argsrepr="(<chat_id>, <message_id>, <url>)",
            retry=False,
        )
    except (KombuError, OSError):
        logger.warning("Could not queue link preview for message %s", message_id)
