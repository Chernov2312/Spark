import asyncio

from tasks.config_celery import celery_app, get_redis, run_async_task

from core.message_queue import history_version_key
from db.dao.message_dao import MessageDao
from db.database import async_session_maker
from schemas.message import MessageInternalDTO


async def sync_messages_task_core(chunk_size: int = 1000) -> None:
    async with get_redis() as redis:
        async for queue_key in redis.scan_iter(match="messages:queue:*"):
            while True:
                entries = await redis.xrange(
                    queue_key,
                    min="-",
                    max="+",
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
                await redis.xdel(queue_key, *(entry_id for entry_id, _ in entries))
                if messages:
                    await redis.incr(history_version_key(messages[0].chat_id))


@celery_app.task(ignore_result=True)
def add_messages_in_db():
    asyncio.run(run_async_task(sync_messages_task_core()))
