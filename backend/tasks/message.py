import asyncio

from db.dao.message_dao import MessageDao
from db.database import async_session_maker
from infrastructure.redis.client import get_redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import MessageInternalDTO
from tasks.config_celery import celery_app, run_async_task


async def sync_messages_task_core(chunk_size: int = 1000) -> None:
    async with get_redis() as redis:
        async for queue_key in RedisDao.iter_message_queue_keys(redis):
            while True:
                entries = await RedisDao.get_stream_entries(
                    redis,
                    queue_key,
                    count=chunk_size,
                )
                if not entries:
                    break

                messages = [
                    MessageInternalDTO.model_validate_json(fields["payload"])
                    for _, fields in entries
                ]
                async with async_session_maker() as session:
                    async with session.begin():
                        await MessageDao.bulk_insert_messages(
                            session=session,
                            data_messages=messages,
                        )
                        await MessageDao.attach_queued_attachments(
                            session=session,
                            data_messages=messages,
                        )

                # A Redis entry is acknowledged only after the database commit.
                await RedisDao.delete_stream_entries(
                    redis,
                    queue_key,
                    [entry_id for entry_id, _ in entries],
                )
                if messages:
                    await RedisDao.invalidate_history(redis, messages[0].chat_id)


@celery_app.task(ignore_result=True)
def add_messages_in_db() -> None:
    asyncio.run(run_async_task(sync_messages_task_core()))
