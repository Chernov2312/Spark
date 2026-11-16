import asyncio
from contextlib import asynccontextmanager
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool
from tasks import config_celery
from tasks import message as message_tasks
from tasks import message_reactions as reaction_tasks

from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao
from db.dao.user_dao import UserDao
from db.database import Base
from db.models import MessageReaction
from infrastructure.redis.client import create_redis_client
from infrastructure.redis.message_queue import enqueue_message, message_queue_key
from schemas.message import MessageInternalDTO


def redis_url_for(container):
    return (
        f"redis://{container.get_container_host_ip()}"
        f":{container.get_exposed_port(6379)}/0"
    )


def task_redis_context(redis_url):
    @asynccontextmanager
    async def redis_context():
        client = create_redis_client(redis_url)
        try:
            yield client
        finally:
            await client.aclose()

    return redis_context


async def create_user_and_chat(session_maker):
    async with session_maker() as session:
        user = await UserDao.add(
            session,
            {
                "username": f"celery_{uuid.uuid4().hex[:12]}",
                "email": f"{uuid.uuid4().hex}@example.com",
                "password": "test-password",
                "is_verified": True,
            },
        )
        chat = await ChatDao.add(
            session,
            {
                "owner_id": user.id,
                "title": f"Celery {uuid.uuid4().hex[:12]}",
                "description": "",
            },
        )
        await ChatDao.add_users_to_chat(session, chat.id, [user.id])
        await session.commit()
        return user.id, chat.id


def test_celery_message_and_reaction_tasks_with_testcontainers(
    postgres_container,
    redis_container,
    monkeypatch,
):
    redis_url = redis_url_for(redis_container)
    db_url = postgres_container.get_connection_url(driver="asyncpg")
    task_engine = create_async_engine(db_url, poolclass=NullPool)
    session_maker = async_sessionmaker(task_engine, expire_on_commit=False)

    monkeypatch.setattr(config_celery, "engine", task_engine)
    monkeypatch.setattr(message_tasks, "async_session_maker", session_maker)
    monkeypatch.setattr(reaction_tasks, "async_session_maker", session_maker)
    monkeypatch.setattr(message_tasks, "get_redis", task_redis_context(redis_url))
    monkeypatch.setattr(reaction_tasks, "get_redis", task_redis_context(redis_url))

    async def prepare_message_task():
        async with task_engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
        redis = create_redis_client(redis_url)
        await redis.flushdb()
        user_id, chat_id = await create_user_and_chat(session_maker)
        message = MessageInternalDTO(
            id=uuid.uuid4(),
            chat_id=chat_id,
            user_id=user_id,
            text="Persisted by the Celery task",
            attachments=[],
        )
        await enqueue_message(redis, message)
        await redis.aclose()
        return user_id, chat_id, message

    user_id, chat_id, queued_message = asyncio.run(prepare_message_task())

    # Invoke the registered synchronous Celery task, including its own
    # asyncio.run() wrapper and async engine cleanup.
    message_tasks.add_messages_in_db.run()

    async def verify_message_and_prepare_reaction():
        redis = create_redis_client(redis_url)
        async with session_maker() as session:
            persisted = await MessageDao.get_by_id(session, queued_message.id)
            assert persisted is not None
            assert persisted.text == "Persisted by the Celery task"
            assert await redis.xlen(message_queue_key(chat_id)) == 0

            reaction = await MessageReactionDao.add(
                session,
                {
                    "user_id": user_id,
                    "message_id": queued_message.id,
                    "emoji": "👍",
                },
            )
            await session.commit()

        await redis.sadd("message:reactions:dirty_set", str(queued_message.id))
        await redis.hset(
            f"message:reactions_count:{queued_message.id}",
            mapping={"🔥": "1"},
        )
        await redis.sadd(f"message:users:{queued_message.id}", str(user_id))
        await redis.set(
            f"message:user_reaction:{queued_message.id}:{user_id}",
            "🔥",
        )
        await redis.aclose()
        return reaction.id

    reaction_id = asyncio.run(verify_message_and_prepare_reaction())
    reaction_tasks.add_reactions_in_db.run()

    async def verify_reaction_task():
        redis = create_redis_client(redis_url)
        async with session_maker() as session:
            persisted_message = await MessageDao.get_by_id(session, queued_message.id)
            persisted_reaction = await session.scalar(
                select(MessageReaction).where(MessageReaction.id == reaction_id),
            )
            assert persisted_message.reactions_count == {"🔥": 1}
            assert persisted_reaction.emoji == "🔥"

        assert await redis.scard("message:reactions:dirty_set") == 0
        await redis.aclose()

    try:
        asyncio.run(verify_reaction_task())
    finally:
        asyncio.run(task_engine.dispose())
