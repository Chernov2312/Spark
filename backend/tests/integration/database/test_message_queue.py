import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest
from main import app
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker
from tasks import message as message_tasks

from core.message_queue import enqueue_message, message_queue_key
from db.dao.attachment_dao import AttachmentDao
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.dao.user_dao import UserDao
from db.models import Message
from schemas.attachment import AttachmentRequest
from schemas.message import MessageInternalDTO


def make_message(chat_id, user_id, attachment_id=None):
    attachments = []
    if attachment_id:
        attachments.append(
            AttachmentRequest(
                id=attachment_id,
                chat_id=chat_id,
                file_key=f"user_message/{user_id}/test.txt",
                file_name="test.txt",
                file_size=4,
                mime_type="text/plain",
            ),
        )
    return MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=chat_id,
        user_id=user_id,
        text="queued integration message",
        attachments=attachments,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )


async def create_persisted_chat(db_engine):
    session_factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with session_factory() as session:
        user = await UserDao.add(
            session,
            {
                "username": f"queue_{uuid.uuid4().hex[:12]}",
                "email": f"{uuid.uuid4().hex}@example.com",
                "password": "test-password",
                "is_verified": True,
            },
        )
        chat = await ChatDao.add(
            session,
            {
                "owner_id": user.id,
                "title": f"Queue {uuid.uuid4().hex[:12]}",
                "description": "",
            },
        )
        await ChatDao.add_users_to_chat(session, chat.id, [user.id])
        await session.commit()
        return session_factory, user.id, chat.id


async def test_message_flush_commits_attachments_and_is_idempotent(
    db_engine,
    test_redis_client,
    monkeypatch,
):
    session_factory, user_id, chat_id = await create_persisted_chat(db_engine)
    attachment_file_key = f"user_message/{user_id}/test.txt"
    async with session_factory() as session:
        attachment = await AttachmentDao.add(
            session,
            {
                "chat_id": chat_id,
                "file_key": attachment_file_key,
                "file_name": "test.txt",
                "file_size": 4,
                "mime_type": "text/plain",
            },
        )
        await session.commit()
        attachment_id = attachment.id

    queued_message = make_message(chat_id, user_id, attachment_id)
    queued_message.attachments[0].file_key = attachment_file_key
    redis = app.state.redis

    @asynccontextmanager
    async def redis_context():
        yield redis

    monkeypatch.setattr(message_tasks, "get_redis", redis_context)
    monkeypatch.setattr(
        message_tasks,
        "async_session_maker",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    await enqueue_message(redis, queued_message)

    await message_tasks.sync_messages_task_core()

    assert await redis.xlen(message_queue_key(chat_id)) == 0
    async with session_factory() as session:
        persisted_message = await MessageDao.get_by_id(session, queued_message.id)
        persisted_attachment = await AttachmentDao.get_by_id(session, attachment_id)
        message_count = await session.scalar(
            select(func.count())
            .select_from(Message)
            .where(
                Message.id == queued_message.id,
            ),
        )
    assert persisted_message is not None
    assert persisted_attachment.msg_id == queued_message.id
    assert message_count == 1

    await enqueue_message(redis, queued_message)
    await message_tasks.sync_messages_task_core()
    async with session_factory() as session:
        message_count = await session.scalar(
            select(func.count())
            .select_from(Message)
            .where(
                Message.id == queued_message.id,
            ),
        )
    assert message_count == 1
    assert await redis.xlen(message_queue_key(chat_id)) == 0


async def test_message_flush_keeps_redis_entry_when_database_commit_fails(
    db_engine,
    test_redis_client,
    monkeypatch,
):
    _, user_id, chat_id = await create_persisted_chat(db_engine)
    queued_message = make_message(chat_id, user_id)
    redis = app.state.redis

    @asynccontextmanager
    async def redis_context():
        yield redis

    async def fail_insert(*args, **kwargs):
        raise RuntimeError("database is unavailable")

    monkeypatch.setattr(message_tasks, "get_redis", redis_context)
    monkeypatch.setattr(
        message_tasks,
        "async_session_maker",
        async_sessionmaker(db_engine, expire_on_commit=False),
    )
    monkeypatch.setattr(MessageDao, "bulk_insert_messages", fail_insert)
    await enqueue_message(redis, queued_message)

    with pytest.raises(RuntimeError, match="database is unavailable"):
        await message_tasks.sync_messages_task_core()

    assert await redis.xlen(message_queue_key(chat_id)) == 1
