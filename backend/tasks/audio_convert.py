import asyncio
import os

from tasks.config_celery import celery_app, get_redis

from core.converter_audio import AudioConverter
from core.storage import S3Storage
from schemas.websockets import AttachmentText, WsEvent


async def send_text(user_id, chat_id, msg_id, audio_url):
    async with get_redis() as redis:
        s3 = S3Storage()
        destination_path = f"../audio/convert/{chat_id}/{msg_id}"
        s3.load_file(audio_url, destination_path)
        text = AudioConverter.get_text_from_audio(path=destination_path)
        if os.path.exists(destination_path):
            os.remove(destination_path)
        event = WsEvent(
            event="attachment:text",
            data=AttachmentText(
                message_id=msg_id,
                text=text,
                user_id=user_id,
                audio_url=audio_url,
            ),
        )
        channel_key = f"chat:{chat_id}"
        await redis.publish(channel_key, event.model_dump_json())


@celery_app.task
def convert_audio_task(user_id, chat_id, msg_id, audio_url):
    asyncio.run(send_text(user_id, chat_id, msg_id, audio_url))
