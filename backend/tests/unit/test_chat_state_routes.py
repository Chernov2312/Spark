import uuid

from fastapi import HTTPException
import pytest

from api.v1 import chats as chats_api
from db.dao.message_dao import MessageDao
from schemas.chat_state import ChatMemberRoleUpdate, MarkChatReadRequest


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
