import asyncio
import logging

from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao
from db.database import async_session_maker
from infrastructure.redis.client import get_redis
from infrastructure.redis.redis_dao import RedisDao, RedisReactionSyncData
from tasks.config_celery import celery_app, run_async_task

logger = logging.getLogger(__name__)


async def clear_redis() -> list[RedisReactionSyncData]:
    async with get_redis() as redis:
        return await RedisDao.clear_reaction_cache(redis)


async def sync_reactions_task_core() -> None:
    try:
        while True:
            async with async_session_maker() as session:
                reactions = await clear_redis()

                if not reactions:
                    break
                async with session.begin():
                    await MessageDao.update_msg_reactions_by_ids(
                        session=session,
                        message_reactions=reactions,
                    )
                    await MessageReactionDao.update_user_reactions(
                        session=session,
                        message_reactions=reactions,
                    )
    except Exception:
        logger.exception("Failed to synchronize message reactions")


@celery_app.task(ignore_result=True)
def add_reactions_in_db() -> None:
    asyncio.run(run_async_task(sync_reactions_task_core()))
