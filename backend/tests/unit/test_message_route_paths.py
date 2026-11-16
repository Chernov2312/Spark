from types import SimpleNamespace
from unittest.mock import AsyncMock
import uuid

from fastapi import HTTPException
import pytest

from api.v1 import message as message_api
from core.message_queue import (
    history_cache_key,
    history_version_key,
    message_queue_key,
)
from schemas.attachment import AttachmentRequest
from schemas.message import MessageHistory, MessageRequest


async def test_history_returns_valid_cache_without_database_access(
    monkeypatch,
    db_session,
    test_redis_client,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    history = MessageHistory(messages=[])
    redis = test_redis_client
    await redis.set(history_version_key(chat_id), "3")
    cache_key = history_cache_key(chat_id, user_id, 50, None, 3)
    await redis.set(cache_key, history.model_dump_json())
    database_lookup = AsyncMock()
    monkeypatch.setattr(message_api.ChatDao, "get_chat_with_users", database_lookup)

    result = await message_api.get_messages_history(
        chat_id,
        50,
        None,
        user_id,
        db_session,
        redis,
    )

    assert result == history
    database_lookup.assert_not_awaited()


async def test_history_discards_bad_cache_and_reports_missing_or_nonmember_chat(
    monkeypatch,
    db_session,
    test_redis_client,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = test_redis_client
    cache_key = history_cache_key(chat_id, user_id, 50, None, 0)
    await redis.set(cache_key, "not-json")
    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=None),
    )

    with pytest.raises(HTTPException) as exc:
        await message_api.get_messages_history(
            chat_id,
            50,
            None,
            user_id,
            db_session,
            redis,
        )
    assert exc.value.status_code == 404
    assert await redis.get(cache_key) is None

    await redis.delete(history_version_key(chat_id))
    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[])),
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.get_messages_history(
            chat_id,
            50,
            None,
            user_id,
            db_session,
            redis,
        )
    assert exc.value.status_code == 403


async def test_history_loads_database_and_caches_member_history(
    monkeypatch,
    db_session,
    test_redis_client,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = test_redis_client
    chat = SimpleNamespace(users=[SimpleNamespace(id=user_id)])
    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=chat),
    )
    monkeypatch.setattr(
        message_api.MessageDao,
        "get_chat_history",
        AsyncMock(return_value=[]),
    )
    monkeypatch.setattr(
        message_api.MessageReactionDao,
        "get_user_reactions",
        AsyncMock(return_value=[]),
    )

    result = await message_api.get_messages_history(
        chat_id,
        50,
        None,
        user_id,
        db_session,
        redis,
    )

    assert result.messages == []
    assert await redis.get(history_cache_key(chat_id, user_id, 50, None, 0))


def attachment(chat_id, *, file_key="user_message/file.txt"):
    return AttachmentRequest(
        chat_id=chat_id,
        file_key=file_key,
        file_name="file.txt",
        file_size=4,
        mime_type="text/plain",
    )


async def test_missing_chat_nonmember_duplicate_and_invalid_attachment(
    monkeypatch,
    db_session,
    test_redis_client,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = test_redis_client
    request = MessageRequest(text="hello", attachments=[])
    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=None),
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, request, db_session, user_id, redis)
    assert exc.value.status_code == 404

    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[])),
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, request, db_session, user_id, redis)
    assert exc.value.status_code == 403

    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[SimpleNamespace(id=user_id)])),
    )
    duplicate = MessageRequest(
        text="hello",
        attachments=[attachment(chat_id), attachment(chat_id)],
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, duplicate, db_session, user_id, redis)
    assert exc.value.status_code == 422

    monkeypatch.setattr(
        message_api.AttachmentDao,
        "get_pending_message_attachments",
        AsyncMock(return_value=[]),
    )
    invalid = MessageRequest(text="hello", attachments=[attachment(chat_id)])
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, invalid, db_session, user_id, redis)
    assert exc.value.status_code == 422


async def test_create_message_queues_valid_empty_attachment_message(
    monkeypatch,
    db_session,
    test_redis_client,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = test_redis_client
    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[SimpleNamespace(id=user_id)])),
    )
    result = await message_api.create_message(
        chat_id,
        MessageRequest(text="hello", attachments=[]),
        db_session,
        user_id,
        redis,
    )

    assert result.text == "hello"
    assert await redis.xlen(message_queue_key(chat_id)) == 1
    assert await redis.get(f"message:chat:{result.id}") == str(chat_id)


async def test_update_and_delete_message_cover_missing_and_success(
    monkeypatch,
    db_session,
    test_redis_client,
):
    message_id, chat_id, user_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    session = db_session
    redis = test_redis_client
    monkeypatch.setattr(
        message_api.MessageDao,
        "update_by_id",
        AsyncMock(return_value=None),
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.update_message(
            message_id,
            MessageRequest(text="x"),
            session,
            user_id,
            redis,
        )
    assert exc.value.status_code == 404

    updated = SimpleNamespace(chat_id=chat_id)
    monkeypatch.setattr(
        message_api.MessageDao,
        "update_by_id",
        AsyncMock(return_value=updated),
    )
    result = await message_api.update_message(
        message_id,
        MessageRequest(text="x"),
        session,
        user_id,
        redis,
    )
    assert result is updated
    assert await redis.get(history_version_key(chat_id)) == "1"

    monkeypatch.setattr(
        message_api.MessageDao,
        "get_chat_id_by_message",
        AsyncMock(return_value=chat_id),
    )
    monkeypatch.setattr(
        message_api.MessageDao,
        "delete_by_id",
        AsyncMock(return_value=False),
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.delete_message(message_id, session, user_id, redis)
    assert exc.value.status_code == 404

    monkeypatch.setattr(
        message_api.MessageDao,
        "delete_by_id",
        AsyncMock(return_value=True),
    )
    result = await message_api.delete_message(message_id, session, user_id, redis)
    assert result == {"deleted": True}
    assert await redis.get(history_version_key(chat_id)) == "2"
