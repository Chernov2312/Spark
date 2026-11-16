import asyncio
import logging
from pathlib import Path
import tempfile
import uuid

from core.converter_audio import AudioConverter
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.database import async_session_maker
from infrastructure.redis.client import get_redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.websockets import AttachmentText, WsEvent
from tasks.config_celery import celery_app, run_async_task

logger = logging.getLogger(__name__)


def _create_temporary_audio_path() -> str:
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as audio_file:
        return audio_file.name


async def send_text(
    user_id: str,
    chat_id: str,
    msg_id: str,
    attachment_id: str,
    file_key: str,
) -> None:
    text = ""
    error = False
    destination_path = await asyncio.to_thread(_create_temporary_audio_path)
    async with get_redis() as redis:
        try:
            await S3Storage().load_file(file_key, destination_path)
            text = await AudioConverter.get_text_from_audio(path=destination_path) or ""
        except Exception:
            logger.exception(
                "Audio transcription failed for attachment %s",
                attachment_id,
            )
            error = True
        try:
            async with async_session_maker() as session:
                async with session.begin():
                    await AttachmentDao.update_by_id(
                        session,
                        uuid.UUID(attachment_id),
                        {"text": text},
                    )
            event = WsEvent(
                event="attachment:text",
                data=AttachmentText(
                    chat_id=chat_id,
                    message_id=msg_id,
                    attachment_id=attachment_id,
                    text=text,
                    user_id=user_id,
                    error=error,
                ),
            )
            await RedisDao.publish_chat_event(
                redis,
                uuid.UUID(chat_id),
                event.model_dump_json(),
            )
        finally:
            await asyncio.to_thread(
                Path(destination_path).unlink,
                missing_ok=True,
            )


@celery_app.task
def convert_audio_task(
    user_id: str,
    chat_id: str,
    msg_id: str,
    attachment_id: str,
    file_key: str,
) -> None:
    asyncio.run(
        run_async_task(send_text(user_id, chat_id, msg_id, attachment_id, file_key)),
    )
