from datetime import datetime, timedelta
import uuid

from fastapi import HTTPException
from httpx2 import AsyncClient
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.v1.chats import get_chat_members
from core.security import create_access_token
from db.dao.chat_dao import ChatDao
from db.models import Attachment, Chat, User


async def test_member_profiles_include_only_user_avatars_in_creation_order(
    db_session: AsyncSession,
    db_user: User,
    db_userchat: tuple[Chat, User],
    minio_s3_storage: None,
    api_client: AsyncClient,
) -> None:
    chat, member = db_userchat
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    await ChatDao.set_member_role(db_session, chat.id, member.id, "moderator")
    now = datetime(2026, 1, 1)
    for name, chat_id, is_avatar, created_at in [
        ("new.png", None, True, now + timedelta(days=1)),
        ("old.png", None, True, now),
        ("group.png", chat.id, True, now),
        ("attachment.png", chat.id, False, now),
    ]:
        db_session.add(
            Attachment(
                user_id=member.id,
                chat_id=chat_id,
                is_avatar=is_avatar,
                file_key=f"user_avatar/{member.id}/{name}",
                file_name=name,
                file_size=10,
                mime_type="image/png",
                created_at=created_at,
            )
        )
    await db_session.flush()

    loaded = await ChatDao.get_chat_with_users(db_session, chat.id, include_avatars=True)
    loaded_member = next(user for user in loaded.users if user.id == member.id)
    assert {avatar.file_name for avatar in loaded_member.avatars} == {
        "old.png",
        "new.png",
    }

    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(member.id)})}"}
    response = await api_client.get(f"/api/v1/chats/{chat.id}/members", headers=headers)
    assert response.status_code == 200
    profiles = response.json()
    assert [profile["role"] for profile in profiles] == ["owner", "moderator"]
    assert profiles[0]["avatar_urls"] == []
    assert profiles[1]["created_at"] is not None
    assert "old.png" in profiles[1]["avatar_urls"][0]
    assert "new.png" in profiles[1]["avatar_urls"][1]
    assert all(
        "email" not in profile and "password" not in profile for profile in profiles
    )


async def test_member_profiles_are_only_visible_to_chat_members(
    db_session: AsyncSession,
    db_userchat: tuple[Chat, User],
) -> None:
    chat, member = db_userchat
    for chat_id, requester_id in [(chat.id, uuid.uuid4()), (uuid.uuid4(), member.id)]:
        with pytest.raises(HTTPException) as error:
            await get_chat_members(chat_id, db_session, requester_id)
        assert error.value.status_code == 404
