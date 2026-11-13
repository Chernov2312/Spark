import asyncio
import uuid
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from tasks import audio_convert, config_celery, message_reactions, scheduler

from core import send_email
from db.dao.attachment_dao import AttachmentDao
from db.dao.message_dao import MessageDao
from schemas.websockets import WsEvent


def redis_context(redis):
    @asynccontextmanager
    async def get_redis():
        yield redis

    return get_redis


def test_send_verification_email_builds_and_sends_html_message(monkeypatch):
    smtp = MagicMock()
    smtp_context = MagicMock()
    smtp_context.__enter__.return_value = smtp
    monkeypatch.setattr(
        send_email.smtplib,
        "SMTP_SSL",
        MagicMock(return_value=smtp_context),
    )

    send_email.send_verification_email(
        "person@example.com",
        "person",
        "user-id",
        "https://spark.example",
    )

    smtp.login.assert_called_once()
    sent_message = smtp.send_message.call_args.args[0]
    assert sent_message["To"] == "person@example.com"
    assert "verification/" in sent_message.get_content()


def test_send_verification_email_swallows_smtp_errors(monkeypatch):
    smtp_context = MagicMock()
    smtp_context.__enter__.side_effect = OSError("smtp unavailable")
    monkeypatch.setattr(
        send_email.smtplib,
        "SMTP_SSL",
        MagicMock(return_value=smtp_context),
    )

    send_email.send_verification_email(
        "person@example.com",
        "person",
        "id",
        "https://example.com",
    )


@pytest.mark.parametrize("fail_upload", [False, True])
async def test_audio_task_persists_transcript_and_publishes_result(
    monkeypatch,
    db_session,
    test_redis_client,
    id_first_user,
    chat_id,
    fail_upload,
):
    user_id = str(id_first_user)
    chat_id = str(chat_id)
    message_id = str(uuid.uuid4())
    attachment = await AttachmentDao.add(
        db_session,
        {
            "chat_id": uuid.UUID(chat_id),
            "file_key": "user_message/audio.ogg",
            "file_name": "audio.ogg",
            "file_size": 4,
            "mime_type": "audio/ogg",
        },
    )
    await db_session.flush()
    attachment_id = str(attachment.id)
    redis = test_redis_client
    pubsub = redis.pubsub()
    channel_name = f"chat:{chat_id}"
    await pubsub.subscribe(channel_name)
    storage = SimpleNamespace(load_file=AsyncMock())
    if fail_upload:
        storage.load_file.side_effect = OSError("object unavailable")
    monkeypatch.setattr(audio_convert, "get_redis", redis_context(redis))
    monkeypatch.setattr(audio_convert, "S3Storage", MagicMock(return_value=storage))
    monkeypatch.setattr(
        audio_convert.AudioConverter,
        "get_text_from_audio",
        MagicMock(return_value="spoken words"),
    )

    @asynccontextmanager
    async def session_context():
        yield db_session

    @asynccontextmanager
    async def existing_transaction():
        yield db_session

    monkeypatch.setattr(db_session, "begin", lambda: existing_transaction())
    monkeypatch.setattr(audio_convert, "async_session_maker", session_context)

    await audio_convert.send_text(
        user_id,
        chat_id,
        message_id,
        attachment_id,
        "audio/key",
    )

    await db_session.refresh(attachment)
    assert attachment.text == ("" if fail_upload else "spoken words")
    published = None
    for _ in range(5):
        published = await pubsub.get_message(
            ignore_subscribe_messages=True,
            timeout=1,
        )
        if published and published["type"] == "message":
            break
    event = WsEvent.model_validate_json(published["data"])
    assert published["channel"] == channel_name
    assert event.event == "attachment:text"
    assert event.data.error is fail_upload
    await pubsub.aclose()


async def test_clear_redis_maps_reactions_and_drops_zero_counts(
    monkeypatch,
    test_redis_client,
):
    redis = test_redis_client
    message_id, user_id = str(uuid.uuid4()), str(uuid.uuid4())
    await redis.sadd("message:reactions:dirty_set", message_id)
    await redis.hset(
        f"message:reactions_count:{message_id}",
        mapping={"🔥": "2", "🫥": "0"},
    )
    await redis.sadd(f"message:users:{message_id}", user_id)
    await redis.set(f"message:user_reaction:{message_id}:{user_id}", "🔥")
    monkeypatch.setattr(message_reactions, "get_redis", redis_context(redis))

    result = await message_reactions.clear_redis()

    assert result == [
        {
            "id": uuid.UUID(message_id),
            "users": {user_id: "🔥"},
            "reactions_count": {"🔥": 2},
        },
    ]
    assert await message_reactions.clear_redis() == []


async def test_reaction_sync_persists_batches_until_queue_is_empty(
    monkeypatch,
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
):
    redis = test_redis_client
    message = await MessageDao.add(
        db_session,
        {"chat_id": chat_id, "user_id": id_first_user, "text": "react to me"},
    )
    await db_session.flush()
    await redis.sadd("message:reactions:dirty_set", str(message.id))
    await redis.hset(f"message:reactions_count:{message.id}", mapping={"🔥": "1"})

    monkeypatch.setattr(message_reactions, "get_redis", redis_context(redis))

    @asynccontextmanager
    async def session_context():
        yield db_session

    @asynccontextmanager
    async def existing_transaction():
        yield db_session

    monkeypatch.setattr(db_session, "begin", lambda: existing_transaction())
    monkeypatch.setattr(
        message_reactions,
        "async_session_maker",
        session_context,
    )

    await message_reactions.sync_reactions_task_core()

    await db_session.refresh(message)
    assert message.reactions_count == {"🔥": 1}
    assert await redis.scard("message:reactions:dirty_set") == 0


async def test_reaction_sync_swallows_database_errors(
    monkeypatch,
    db_session,
    test_redis_client,
):
    redis = test_redis_client
    message_id = str(uuid.uuid4())
    await redis.sadd("message:reactions:dirty_set", message_id)
    await redis.hset(f"message:reactions_count:{message_id}", mapping={"🔥": "1"})
    monkeypatch.setattr(message_reactions, "get_redis", redis_context(redis))

    async def fail_update(*args, **kwargs):
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(
        message_reactions.MessageDao,
        "update_msg_reactions_by_ids",
        fail_update,
    )

    @asynccontextmanager
    async def session_context():
        yield db_session

    monkeypatch.setattr(
        message_reactions,
        "async_session_maker",
        session_context,
    )

    await message_reactions.sync_reactions_task_core()
    assert await redis.scard("message:reactions:dirty_set") == 0


def test_scheduler_chains_message_and_reaction_sync(monkeypatch):
    message_task = MagicMock()
    reaction_task = MagicMock()
    signature = MagicMock()
    message_task.si.return_value = signature
    reaction_task.si.return_value = signature
    chain = MagicMock()
    monkeypatch.setattr(scheduler, "add_messages_in_db", message_task)
    monkeypatch.setattr(scheduler, "add_reactions_in_db", reaction_task)
    monkeypatch.setattr(scheduler, "chain", chain)

    scheduler.master_sync_scheduler()

    message_task.si.assert_called_once_with()
    reaction_task.si.assert_called_once_with()
    chain.assert_called_once()
    chain.return_value.apply_async.assert_called_once_with()


def test_audio_conversion_task_dispatches_async_work(monkeypatch):
    send = MagicMock()

    async def send_async(*args):
        send(*args)

    monkeypatch.setattr(audio_convert, "send_text", send_async)

    async def run_without_engine_disposal(coroutine):
        return await coroutine

    monkeypatch.setattr(audio_convert, "run_async_task", run_without_engine_disposal)

    audio_convert.convert_audio_task("user", "chat", "message", "attachment", "key")

    send.assert_called_once_with("user", "chat", "message", "attachment", "key")


def test_async_celery_task_runner_disposes_engine(monkeypatch):
    dispose = AsyncMock()
    monkeypatch.setattr(
        config_celery,
        "engine",
        SimpleNamespace(dispose=dispose),
    )

    async def task():
        return "done"

    assert asyncio.run(config_celery.run_async_task(task())) == "done"
    dispose.assert_awaited_once_with()
