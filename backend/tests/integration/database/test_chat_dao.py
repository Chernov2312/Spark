import uuid

from sqlalchemy import func, select

from db.dao.chat_dao import ChatDao
from db.models import Chat, user_chat


async def test_get_missing_user_ids_returns_only_unknown_ids(db_session, db_user):
    missing_user_id = uuid.uuid4()

    assert await ChatDao.get_missing_user_ids(
        db_session,
        [db_user.id, missing_user_id],
    ) == {missing_user_id}
    assert await ChatDao.get_missing_user_ids(db_session, []) == set()


async def test_add_users_to_chat_is_idempotent_and_loads_members(
    db_session,
    db_user,
    db_userchat,
):
    chat, invited_user = db_userchat

    await ChatDao.add_users_to_chat(db_session, chat.id, [invited_user.id])
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])

    member_count = await db_session.scalar(
        select(func.count()).select_from(user_chat).where(user_chat.c.chat_id == chat.id),
    )
    db_session.expire(chat, ["users"])
    loaded_chat = await ChatDao.get_chat_with_users(db_session, chat.id)

    assert member_count == 2
    assert {member.id for member in loaded_chat.users} == {db_user.id, invited_user.id}
    assert await ChatDao.get_chat_with_users(db_session, uuid.uuid4()) is None


async def test_chat_base_dao_returns_none_after_missing_delete(db_session, db_user):
    chat = await ChatDao.add(
        db_session,
        {
            "owner_id": db_user.id,
            "title": "dao-delete-chat",
            "description": "test",
        },
    )

    assert await ChatDao.get_by_id(db_session, chat.id) is not None
    assert await ChatDao.delete_by_id(db_session, chat.id) is True
    assert await ChatDao.delete_by_id(db_session, chat.id) is False
    assert await ChatDao.get_by_id(db_session, chat.id) is None
    assert isinstance(chat, Chat)
