import json
from unittest.mock import Mock
import uuid

from fastapi import status
from httpx2 import AsyncClient
import pytest
from tasks.link_preview import parse_link_preview_task
from unit.schemas import GetMessageHistory

from core.security import create_access_token
from db.dao.attachment_dao import AttachmentDao
from db.dao.message_dao import MessageDao
from infrastructure.redis.message_queue import (
    history_cache_key,
    history_version_key,
    message_queue_key,
)
from infrastructure.redis.redis_dao import RedisDao
from main import app
from schemas.message import LinkPreview


async def test_history_uses_only_preview_url_supplied_by_client(
    api_client: AsyncClient,
    auth_token_and_user: str,
    chat_id: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    submit = Mock()
    monkeypatch.setattr(parse_link_preview_task, "apply_async", submit)
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    endpoint = f"/api/v1/chats/{chat_id}/messages"
    url = "https://second.example.com/"
    text = f"https://first.example.com/ {url}"

    without_selection = await api_client.post(
        endpoint, headers=headers, json={"text": text}
    )
    assert without_selection.status_code == status.HTTP_201_CREATED
    submit.assert_not_called()

    with_selection = await api_client.post(
        endpoint, headers=headers, json={"text": text, "link_preview_url": url}
    )
    assert with_selection.status_code == status.HTTP_201_CREATED
    message_id = with_selection.json()["id"]
    submit.assert_called_once()
    assert submit.call_args.kwargs["args"] == (str(chat_id), message_id, url)

    preview = LinkPreview(url=url, title="Selected link")
    await RedisDao.cache_link_preview(
        app.state.redis, chat_id, uuid.UUID(message_id), preview
    )
    history = await api_client.get(endpoint, headers=headers)
    assert history.status_code == status.HTTP_200_OK
    by_id = {row["id"]: row for row in history.json()["messages"]}
    assert by_id[message_id]["link_preview"] == preview.model_dump()
    assert by_id[without_selection.json()["id"]]["link_preview"] is None


async def test_history_keeps_sender_and_quote_for_queued_messages(
    api_client: AsyncClient,
    auth_token_and_user: str,
    chat_id: uuid.UUID,
    id_first_user: uuid.UUID,
    id_second_user: uuid.UUID,
) -> None:
    history_url = f"/api/v1/chats/{chat_id}/messages"
    first_headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    second_token = create_access_token({"sub": str(id_second_user)})
    second_headers = {"Authorization": f"Bearer {second_token}"}
    original = await api_client.post(
        history_url,
        headers=first_headers,
        json={"text": "Original message"},
    )
    assert original.status_code == status.HTTP_201_CREATED
    original_id = original.json()["id"]
    reply = await api_client.post(
        history_url,
        headers=second_headers,
        json={"text": "Reply", "reply_to_id": original_id},
    )
    assert reply.status_code == status.HTTP_201_CREATED
    reply_id = reply.json()["id"]

    for headers in (first_headers, second_headers):
        history = await api_client.get(history_url, headers=headers)
        assert history.status_code == status.HTTP_200_OK
        by_id = {message["id"]: message for message in history.json()["messages"]}
        assert by_id[original_id]["user_id"] == str(id_first_user)
        assert by_id[reply_id]["user_id"] == str(id_second_user)
        assert by_id[reply_id]["reply_to_id"] == original_id
        assert by_id[reply_id]["reply_to_text"] == "Original message"


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
