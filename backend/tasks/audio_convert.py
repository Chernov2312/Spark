import asyncio
import logging
import os
import tempfile
import uuid

from core.converter_audio import AudioConverter
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.database import async_session_maker
from schemas.websockets import AttachmentText, WsEvent
from tasks.config_celery import celery_app, get_redis, run_async_task

logger = logging.getLogger(__name__)


async def send_text(user_id, chat_id, msg_id, attachment_id, file_key):
    text = ""
    error = False
    with tempfile.NamedTemporaryFile(suffix=".audio", delete=False) as audio_file:
        destination_path = audio_file.name
    async with get_redis() as redis:
        try:
            await S3Storage().load_file(file_key, destination_path)
            text = AudioConverter.get_text_from_audio(path=destination_path) or ""
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
            await redis.publish(f"chat:{chat_id}", event.model_dump_json())
        finally:
            if os.path.exists(destination_path):
                os.remove(destination_path)


@celery_app.task
def convert_audio_task(user_id, chat_id, msg_id, attachment_id, file_key):
    asyncio.run(
        run_async_task(send_text(user_id, chat_id, msg_id, attachment_id, file_key)),
    )
