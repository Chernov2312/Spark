import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

from api.v1 import message as message_api
from schemas.attachment import AttachmentRequest
from schemas.message import MessageHistory, MessageRequest


async def test_history_returns_valid_cache_without_database_access(monkeypatch):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    history = MessageHistory(messages=[])
    redis = AsyncMock()
    redis.get.side_effect = ["3", history.model_dump_json()]
    database_lookup = AsyncMock()
    monkeypatch.setattr(message_api.ChatDao, "get_chat_with_users", database_lookup)

    result = await message_api.get_messages_history(
        chat_id, 50, None, user_id, object(), redis
    )

    assert result == history
    database_lookup.assert_not_awaited()


async def test_history_discards_bad_cache_and_reports_missing_or_nonmember_chat(
    monkeypatch,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = AsyncMock()
    redis.get.side_effect = ["0", "not-json"]
    monkeypatch.setattr(
        message_api.ChatDao, "get_chat_with_users", AsyncMock(return_value=None)
    )

    with pytest.raises(HTTPException) as exc:
        await message_api.get_messages_history(
            chat_id, 50, None, user_id, object(), redis
        )
    assert exc.value.status_code == 404
    redis.delete.assert_awaited_once()

    redis.get.side_effect = [None, None]
    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[])),
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.get_messages_history(
            chat_id, 50, None, user_id, object(), redis
        )
    assert exc.value.status_code == 403


async def test_history_loads_database_and_caches_member_history(monkeypatch):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = AsyncMock()
    redis.get.side_effect = [None, None, "0"]
    redis.xrange.return_value = []
    chat = SimpleNamespace(users=[SimpleNamespace(id=user_id)])
    monkeypatch.setattr(
        message_api.ChatDao, "get_chat_with_users", AsyncMock(return_value=chat)
    )
    monkeypatch.setattr(
        message_api.MessageDao, "get_chat_history", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(
        message_api.MessageReactionDao, "get_user_reactions", AsyncMock(return_value=[])
    )

    result = await message_api.get_messages_history(
        chat_id, 50, None, user_id, object(), redis
    )

    assert result.messages == []
    redis.set.assert_awaited_once()


def attachment(chat_id, *, file_key="user_message/file.txt"):
    return AttachmentRequest(
        chat_id=chat_id,
        file_key=file_key,
        file_name="file.txt",
        file_size=4,
        mime_type="text/plain",
    )


async def test_create_message_rejects_missing_chat_nonmember_duplicate_and_invalid_attachment(
    monkeypatch,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = AsyncMock()
    request = MessageRequest(text="hello", attachments=[])
    monkeypatch.setattr(
        message_api.ChatDao, "get_chat_with_users", AsyncMock(return_value=None)
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, request, object(), user_id, redis)
    assert exc.value.status_code == 404

    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[])),
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, request, object(), user_id, redis)
    assert exc.value.status_code == 403

    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[SimpleNamespace(id=user_id)])),
    )
    duplicate = MessageRequest(
        text="hello", attachments=[attachment(chat_id), attachment(chat_id)]
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, duplicate, object(), user_id, redis)
    assert exc.value.status_code == 422

    monkeypatch.setattr(
        message_api.AttachmentDao,
        "get_pending_message_attachments",
        AsyncMock(return_value=[]),
    )
    invalid = MessageRequest(text="hello", attachments=[attachment(chat_id)])
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, invalid, object(), user_id, redis)
    assert exc.value.status_code == 422


async def test_create_message_queues_valid_empty_attachment_message(monkeypatch):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    redis = AsyncMock()
    monkeypatch.setattr(
        message_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=SimpleNamespace(users=[SimpleNamespace(id=user_id)])),
    )
    response = SimpleNamespace(model_dump=MagicMock(return_value={}))
    build_response = AsyncMock(return_value=response)
    enqueue = AsyncMock()
    monkeypatch.setattr(message_api, "_build_message_response", build_response)
    monkeypatch.setattr(message_api, "enqueue_message", enqueue)

    result = await message_api.create_message(
        chat_id,
        MessageRequest(text="hello", attachments=[]),
        object(),
        user_id,
        redis,
    )

    assert result is response
    enqueue.assert_awaited_once()
    redis.publish.assert_awaited_once()


async def test_update_and_delete_message_cover_missing_and_success(monkeypatch):
    message_id, chat_id, user_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    session = SimpleNamespace(commit=AsyncMock())
    redis = AsyncMock()
    monkeypatch.setattr(
        message_api.MessageDao, "update_by_id", AsyncMock(return_value=None)
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.update_message(
            message_id, MessageRequest(text="x"), session, user_id, redis
        )
    assert exc.value.status_code == 404

    updated = SimpleNamespace(chat_id=chat_id)
    monkeypatch.setattr(
        message_api.MessageDao, "update_by_id", AsyncMock(return_value=updated)
    )
    result = await message_api.update_message(
        message_id, MessageRequest(text="x"), session, user_id, redis
    )
    assert result is updated
    redis.incr.assert_awaited_once()

    monkeypatch.setattr(
        message_api.MessageDao, "get_chat_id_by_message", AsyncMock(return_value=chat_id)
    )
    monkeypatch.setattr(
        message_api.MessageDao, "delete_by_id", AsyncMock(return_value=False)
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.delete_message(message_id, session, user_id, redis)
    assert exc.value.status_code == 404

    monkeypatch.setattr(
        message_api.MessageDao, "delete_by_id", AsyncMock(return_value=True)
    )
    result = await message_api.delete_message(message_id, session, user_id, redis)
    assert result == {"deleted": True}
    assert redis.incr.await_count == 2
