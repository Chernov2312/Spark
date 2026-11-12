import json
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from tasks import audio_convert, message_reactions, scheduler

from core import send_email
from schemas.websockets import WsEvent


class AsyncContext:
    def __init__(self, value=None):
        self.value = value

    async def __aenter__(self):
        return self.value

    async def __aexit__(self, *args):
        return False


def redis_context(redis):
    @asynccontextmanager
    async def get_redis():
        yield redis

    return get_redis


class FakeRedisPipeline:
    def __init__(self, redis):
        self.redis = redis
        self.commands = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def __getattr__(self, name):
        def queue(*args, **kwargs):
            self.commands.append((name, args, kwargs))
            return self

        return queue

    async def execute(self):
        results = []
        for command, args, _ in self.commands:
            if command == "hgetall":
                results.append(self.redis.hashes.get(args[0], {}).copy())
            elif command == "smembers":
                results.append(self.redis.sets.get(args[0], set()).copy())
            elif command == "get":
                results.append(self.redis.values.get(args[0]))
            else:
                results.append(None)
        return results


class FakeRedis:
    def __init__(self):
        self.hashes = {}
        self.sets = {}
        self.values = {}
        self.dirty = []

    async def spop(self, key, count):
        result, self.dirty = self.dirty[:count], self.dirty[count:]
        return result

    def pipeline(self, transaction=False):
        return FakeRedisPipeline(self)


def test_send_verification_email_builds_and_sends_html_message(monkeypatch):
    smtp = MagicMock()
    smtp_context = MagicMock()
    smtp_context.__enter__.return_value = smtp
    monkeypatch.setattr(
        send_email.smtplib, "SMTP_SSL", MagicMock(return_value=smtp_context)
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
        send_email.smtplib, "SMTP_SSL", MagicMock(return_value=smtp_context)
    )

    send_email.send_verification_email(
        "person@example.com", "person", "id", "https://example.com"
    )


@pytest.mark.parametrize("fail_upload", [False, True])
async def test_audio_task_persists_transcript_and_publishes_result(
    monkeypatch, fail_upload
):
    user_id, chat_id, message_id, attachment_id = [
        "6a0af6f3-6280-4ab7-8507-29dbd2c2e1b1",
        "5e4a94a8-b79b-4af9-a712-85f3f722a7e5",
        "4bc8b10b-460c-435a-b42e-9a5b2f72c86c",
        "b6b4bb68-3639-4e29-9fe8-991b3711ddf0",
    ]
    redis = SimpleNamespace(publish=AsyncMock())
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

    transaction = AsyncContext()
    session = SimpleNamespace(begin=MagicMock(return_value=transaction))

    @asynccontextmanager
    async def session_context():
        yield session

    monkeypatch.setattr(audio_convert, "async_session_maker", session_context)
    update = AsyncMock()
    monkeypatch.setattr(audio_convert.AttachmentDao, "update_by_id", update)

    await audio_convert.send_text(
        user_id, chat_id, message_id, attachment_id, "audio/key"
    )

    saved = update.await_args.args[2]
    assert saved == {"text": "" if fail_upload else "spoken words"}
    channel, payload = redis.publish.await_args.args
    event = WsEvent.model_validate_json(payload)
    assert channel == f"chat:{chat_id}"
    assert event.event == "attachment:text"
    assert event.data.error is fail_upload


async def test_clear_redis_maps_reactions_and_drops_zero_counts(monkeypatch):
    redis = FakeRedis()
    message_id, user_id = "message-1", "user-1"
    redis.dirty = [message_id]
    redis.hashes[f"message:reactions_count:{message_id}"] = {"🔥": "2", "🫥": "0"}
    redis.sets[f"message:users:{message_id}"] = {user_id}
    redis.values[f"message:user_reaction:{message_id}:{user_id}"] = "🔥"
    monkeypatch.setattr(message_reactions, "get_redis", redis_context(redis))

    result = await message_reactions.clear_redis()

    assert result == [
        {"id": message_id, "users": {user_id: "🔥"}, "reactions_count": {"🔥": 2}},
    ]
    assert await message_reactions.clear_redis() == []


async def test_reaction_sync_persists_batches_until_queue_is_empty(monkeypatch):
    changes = [{"id": "message-1", "users": {}, "reactions_count": {"🔥": 1}}]
    clear = AsyncMock(side_effect=[changes, []])
    update_counts = AsyncMock()
    update_users = AsyncMock()
    monkeypatch.setattr(message_reactions, "clear_redis", clear)
    monkeypatch.setattr(
        message_reactions.MessageDao, "update_msg_reactions_by_ids", update_counts
    )
    monkeypatch.setattr(
        message_reactions.MessageReactionDao, "update_user_reactions", update_users
    )
    monkeypatch.setattr(
        message_reactions,
        "async_session_maker",
        MagicMock(
            return_value=AsyncContext(
                SimpleNamespace(begin=MagicMock(return_value=AsyncContext()))
            )
        ),
    )

    await message_reactions.sync_reactions_task_core()

    assert clear.await_count == 2
    update_counts.assert_awaited_once()
    update_users.assert_awaited_once()


async def test_reaction_sync_swallows_database_errors(monkeypatch):
    monkeypatch.setattr(
        message_reactions, "clear_redis", AsyncMock(side_effect=RuntimeError("db failed"))
    )

    await message_reactions.sync_reactions_task_core()


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
    monkeypatch.setattr(audio_convert, "send_text", send)
    monkeypatch.setattr(audio_convert.asyncio, "run", MagicMock())

    audio_convert.convert_audio_task("user", "chat", "message", "attachment", "key")

    send.assert_called_once_with("user", "chat", "message", "attachment", "key")
    audio_convert.asyncio.run.assert_called_once()
    audio_convert.asyncio.run.call_args.args[0].close()
