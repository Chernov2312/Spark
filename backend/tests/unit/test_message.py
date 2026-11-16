import json
import uuid

from fastapi import status
from httpx2 import AsyncClient
from unit.schemas import GetMessageHistory

from db.dao.attachment_dao import AttachmentDao
from db.dao.message_dao import MessageDao
from infrastructure.redis.message_queue import (
    history_cache_key,
    history_version_key,
    message_queue_key,
)
from main import app


async def test_get_chat_history(
    spam_history: uuid.UUID,
    api_client: AsyncClient,
    auth_token_and_user,
):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.get(
        url=f"/api/v1/chats/{spam_history}/messages",
        headers=headers,
    )
    assert res.status_code == status.HTTP_200_OK
    assert GetMessageHistory.model_validate(res.json())


async def test_create_message_is_queued_and_visible_in_cached_history(
    db_session,
    api_client: AsyncClient,
    auth_token_and_user,
    chat_id: uuid.UUID,
    id_first_user: uuid.UUID,
    monkeypatch,
):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    created = await api_client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=headers,
        json={"text": "queued before database flush", "attachments": []},
    )

    assert created.status_code == status.HTTP_201_CREATED
    created_message = created.json()
    assert (
        await MessageDao.get_by_id(
            session=db_session,
            target_id=uuid.UUID(created_message["id"]),
        )
        is None
    )

    entries = await app.state.redis.xrange(message_queue_key(chat_id))
    assert len(entries) == 1
    queued = json.loads(entries[0][1]["payload"])
    assert queued["id"] == created_message["id"]
    assert queued["chat_id"] == str(chat_id)
    assert queued["user_id"] == str(id_first_user)
    assert queued["created_at"]

    history = await api_client.get(
        f"/api/v1/chats/{chat_id}/messages",
        headers=headers,
    )
    assert history.status_code == status.HTTP_200_OK
    assert [item["id"] for item in history.json()["messages"]] == [
        created_message["id"],
    ]

    version = int(await app.state.redis.get(history_version_key(chat_id)))
    cache_key = history_cache_key(chat_id, id_first_user, 50, None, version)
    assert await app.state.redis.get(cache_key)

    async def fail_if_database_history_is_read(*args, **kwargs):
        raise AssertionError("cached history should not query the database")

    monkeypatch.setattr(
        MessageDao,
        "get_chat_history",
        fail_if_database_history_is_read,
    )
    cached_history = await api_client.get(
        f"/api/v1/chats/{chat_id}/messages",
        headers=headers,
    )
    assert cached_history.status_code == status.HTTP_200_OK
    assert cached_history.json() == history.json()


async def test_create_message_rejects_attachment_from_another_chat(
    db_session,
    api_client: AsyncClient,
    auth_token_and_user,
    chat_id: uuid.UUID,
):
    attachment = await AttachmentDao.add(
        db_session,
        {
            "chat_id": chat_id,
            "file_key": f"user_message/{uuid.uuid4()}/test.txt",
            "file_name": "test.txt",
            "file_size": 4,
            "mime_type": "text/plain",
        },
    )
    await db_session.flush()
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}

    response = await api_client.post(
        f"/api/v1/chats/{chat_id}/messages",
        headers=headers,
        json={
            "text": "attachment must be checked",
            "attachments": [
                {
                    "id": str(attachment.id),
                    "chat_id": str(uuid.uuid4()),
                    "file_key": attachment.file_key,
                    "file_name": attachment.file_name,
                    "file_size": attachment.file_size,
                    "mime_type": attachment.mime_type,
                },
            ],
        },
    )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert await app.state.redis.xlen(message_queue_key(chat_id)) == 0
