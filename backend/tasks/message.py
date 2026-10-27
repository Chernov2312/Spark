import asyncio
import uuid

from pydantic import ValidationError
from redis.exceptions import ResponseError
from tasks.config_celery import celery_app, get_redis

from db.dao.message_dao import MessageDao
from db.database import async_session_maker
from schemas.message import MessageInternalDTO


async def clear_redis(chunk_size: int = 1000):
    async with get_redis() as redis:
        temp_key = f"chats:sync:{uuid.uuid4().hex}"
        try:
            await redis.rename("chats", temp_key)
        except ResponseError:
            chats_ids = set()
            temp_key = None

        if temp_key:
            chats_ids = await redis.smembers(temp_key)
            await redis.delete(temp_key)
        else:
            return

        chats_ids_list = list(chats_ids)
        async with redis.pipeline(transaction=False) as pipe:
            for chat_id in chats_ids_list:
                pipe.hgetall(f"chat:{chat_id}")
            chat_data: list[dict] = await pipe.execute()

        async with redis.pipeline(transaction=False) as pipe:
            for chat_id, hash_dict in zip(chats_ids_list, chat_data):
                if hash_dict:
                    pipe.hdel(f"chat:{chat_id}", *hash_dict.keys())
            await pipe.execute()

        current_chunk = []

        for hash_dict in chat_data:
            if not hash_dict:
                continue
            for json_string in hash_dict.values():
                try:
                    message_dto = MessageInternalDTO.model_validate_json(json_string)
                    current_chunk.append(message_dto)
                    if len(current_chunk) >= chunk_size:
                        yield current_chunk
                        current_chunk = []

                except ValidationError:
                    continue

        if current_chunk:
            yield current_chunk


async def sync_messages_task_core():
    async with async_session_maker() as session:
        async for message_chunk in clear_redis(chunk_size=1000):
            async with session.begin():
                try:
                    await MessageDao.bulk_insert_messages(
                        session=session,
                        data_messages=message_chunk,
                    )
                except Exception:
                    continue


@celery_app.task(ignore_result=True)
def add_messages_in_db():
    asyncio.run(sync_messages_task_core())
