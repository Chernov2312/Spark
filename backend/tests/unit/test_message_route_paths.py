import uuid

from fastapi import HTTPException
import pytest

from api.v1 import message as message_api
from db.dao.message_dao import MessageDao
from infrastructure.redis.message_queue import (
    history_cache_key,
    history_version_key,
    message_queue_key,
)
from schemas.attachment import AttachmentRequest
from schemas.message import MessageHistory, MessageRequest


async def test_history_returns_valid_cache_without_database_access(
    db_session,
    test_redis_client,
):
    chat_id, user_id = uuid.uuid4(), uuid.uuid4()
    history = MessageHistory(messages=[])
    redis = test_redis_client
    await redis.set(history_version_key(chat_id), "3")
    cache_key = history_cache_key(chat_id, user_id, 50, None, 3)
    await redis.set(cache_key, history.model_dump_json())
    result = await message_api.get_messages_history(
        chat_id,
        50,
        None,
        user_id,
        db_session,
        redis,
    )

    assert result == history


async def test_history_discards_bad_cache_and_reports_missing_or_nonmember_chat(
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
):
    missing_chat_id = uuid.uuid4()
    user_id = id_first_user
    redis = test_redis_client
    cache_key = history_cache_key(missing_chat_id, user_id, 50, None, 0)
    await redis.set(cache_key, "not-json")

    with pytest.raises(HTTPException) as exc:
        await message_api.get_messages_history(
            missing_chat_id,
            50,
            None,
            user_id,
            db_session,
            redis,
        )
    assert exc.value.status_code == 404
    assert await redis.get(cache_key) is None

    outsider_id = uuid.uuid4()
    with pytest.raises(HTTPException) as exc:
        await message_api.get_messages_history(
            chat_id,
            50,
            None,
            outsider_id,
            db_session,
            redis,
        )
    assert exc.value.status_code == 403


async def test_history_loads_database_and_caches_member_history(
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
):
    user_id = id_first_user
    redis = test_redis_client
    await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat_id, "user_id": user_id, "text": "container history"},
        [],
    )

    result = await message_api.get_messages_history(
        chat_id,
        50,
        None,
        user_id,
        db_session,
        redis,
    )

    assert [message.text for message in result.messages] == ["container history"]
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
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
):
    user_id = id_first_user
    redis = test_redis_client
    request = MessageRequest(text="hello", attachments=[])
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(
            uuid.uuid4(),
            request,
            db_session,
            user_id,
            redis,
        )
    assert exc.value.status_code == 404

    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(
            chat_id,
            request,
            db_session,
            uuid.uuid4(),
            redis,
        )
    assert exc.value.status_code == 403

    duplicate = MessageRequest(
        text="hello",
        attachments=[attachment(chat_id), attachment(chat_id)],
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, duplicate, db_session, user_id, redis)
    assert exc.value.status_code == 422

    invalid = MessageRequest(text="hello", attachments=[attachment(chat_id)])
    with pytest.raises(HTTPException) as exc:
        await message_api.create_message(chat_id, invalid, db_session, user_id, redis)
    assert exc.value.status_code == 422


async def test_create_message_queues_valid_empty_attachment_message(
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
):
    redis = test_redis_client
    result = await message_api.create_message(
        chat_id,
        MessageRequest(text="hello", attachments=[]),
        db_session,
        id_first_user,
        redis,
    )

    assert result.text == "hello"
    assert await redis.xlen(message_queue_key(chat_id)) == 1
    assert await redis.get(f"message:chat:{result.id}") == str(chat_id)


async def test_update_and_delete_message_cover_missing_and_success(
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
    id_second_user,
):
    message_id = uuid.uuid4()
    redis = test_redis_client
    with pytest.raises(HTTPException) as exc:
        await message_api.update_message(
            message_id,
            MessageRequest(text="x"),
            db_session,
            id_first_user,
            redis,
        )
    assert exc.value.status_code == 404

    message = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat_id,
            "user_id": id_first_user,
            "text": "original",
        },
        [],
    )
    with pytest.raises(HTTPException) as exc:
        await message_api.update_message(
            message.id,
            MessageRequest(text="unauthorized"),
            db_session,
            id_second_user,
            redis,
        )
    assert exc.value.status_code == 404

    result = await message_api.update_message(
        message.id,
        MessageRequest(text="updated"),
        db_session,
        id_first_user,
        redis,
    )
    assert result.id == message.id
    assert result.text == "updated"
    assert result.edited_at is not None
    assert await redis.get(history_version_key(chat_id)) == "1"

    with pytest.raises(HTTPException) as exc:
        await message_api.delete_message(message.id, db_session, id_second_user, redis)
    assert exc.value.status_code == 404

    result = await message_api.delete_message(
        message.id,
        db_session,
        id_first_user,
        redis,
    )
    assert result.deleted is True
    assert await redis.get(history_version_key(chat_id)) == "2"
