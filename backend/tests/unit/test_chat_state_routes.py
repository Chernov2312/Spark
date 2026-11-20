import uuid

from fastapi import HTTPException
from httpx2 import AsyncClient
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.v1 import chats as chats_api
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.chat_state import ChatMemberRoleUpdate, MarkChatReadRequest
from schemas.message import MessageInternalDTO


async def test_chat_member_role_and_read_routes_use_container_state(
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
    id_second_user,
):
    members = await chats_api.get_chat_members(chat_id, db_session, id_first_user)
    assert {member.id for member in members} == {id_first_user, id_second_user}

    role = await chats_api.set_chat_member_role(
        chat_id,
        id_second_user,
        ChatMemberRoleUpdate(role="moderator"),
        db_session,
        id_first_user,
    )
    assert role.model_dump() == {"role": "moderator"}
    members = await chats_api.get_chat_members(chat_id, db_session, id_first_user)
    assert (
        next(member for member in members if member.id == id_second_user).role
        == "moderator"
    )

    message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat_id, "user_id": id_first_user, "text": "read this"},
        [],
    )
    result = await chats_api.mark_chat_read(
        chat_id,
        MarkChatReadRequest(message_id=message.id),
        db_session,
        id_second_user,
        test_redis_client,
    )
    assert result.last_read_message_id == message.id

    with pytest.raises(HTTPException) as exc:
        await chats_api.mark_chat_read(
            chat_id,
            MarkChatReadRequest(message_id=uuid.uuid4()),
            db_session,
            id_second_user,
            test_redis_client,
        )
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as exc:
        await chats_api.get_chat_members(chat_id, db_session, uuid.uuid4())
    assert exc.value.status_code == 404


async def test_marks_a_message_read_before_the_celery_batch(
    api_client: AsyncClient,
    db_session: AsyncSession,
    test_redis_client: Redis,
    chat_id: uuid.UUID,
    id_first_user: uuid.UUID,
    id_second_user: uuid.UUID,
    auth_token_and_user: str,
) -> None:
    root_id, unrelated_id, reply_id = (uuid.uuid4() for _ in range(3))
    for message_id, thread_root_id in (
        (root_id, None),
        (unrelated_id, None),
        (reply_id, root_id),
    ):
        await RedisDao.enqueue_message(
            test_redis_client,
            MessageInternalDTO(
                id=message_id,
                chat_id=chat_id,
                user_id=id_second_user,
                text="Сообщение в очереди",
                thread_root_id=thread_root_id,
                reply_to_id=thread_root_id,
            ),
        )
    assert await MessageDao.get_reply_target(db_session, chat_id, reply_id) is None

    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    chat_url = f"/api/v1/chats/{chat_id}"
    for _ in range(2):
        response = await api_client.post(
            f"{chat_url}/read",
            headers=headers,
            json={"message_id": str(reply_id)},
        )
        assert response.status_code == 200, response.text
        assert response.json() == {"last_read_message_id": str(reply_id)}

    members = await chats_api.get_chat_members(chat_id, db_session, id_first_user)
    reader = next(member for member in members if member.id == id_first_user)
    assert reader.last_read_message_id == reply_id
    assert await MessageDao.get_reply_target(db_session, chat_id, root_id) is not None
    assert await MessageDao.get_reply_target(db_session, chat_id, unrelated_id) is None

    for path in ("/messages", "/threads", f"/messages/{root_id}/thread"):
        history = await api_client.get(f"{chat_url}{path}", headers=headers)
        assert history.status_code == 200, history.text
        root = next(
            row for row in history.json()["messages"] if row["id"] == str(root_id)
        )
        assert root["thread_reply_count"] == 1


async def test_rejects_a_queued_read_target_from_another_chat(
    api_client: AsyncClient,
    db_session: AsyncSession,
    test_redis_client: Redis,
    chat_id: uuid.UUID,
    id_second_user: uuid.UUID,
    auth_token_and_user: str,
) -> None:
    other_chat = await ChatDao.add(
        db_session, {"owner_id": id_second_user, "title": "Other chat", "description": ""}
    )
    await ChatDao.add_users_to_chat(db_session, other_chat.id, [id_second_user])
    message = MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=other_chat.id,
        user_id=id_second_user,
        text="Queued in another chat",
    )
    await RedisDao.enqueue_message(test_redis_client, message)

    response = await api_client.post(
        f"/api/v1/chats/{chat_id}/read",
        headers={"Authorization": f"Bearer {auth_token_and_user}"},
        json={"message_id": str(message.id)},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Message does not belong to this chat"}
    assert (
        await MessageDao.get_reply_target(db_session, other_chat.id, message.id) is None
    )
