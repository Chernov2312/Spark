from asyncio import Barrier, TaskGroup
from datetime import datetime, timezone
import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncEngine

from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.dao.user_dao import UserDao
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


async def test_opening_direct_chat_concurrently_reuses_one_chat(
    db_engine: AsyncEngine,
) -> None:
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    first_id, second_id = uuid.uuid4(), uuid.uuid4()
    async with sessions.begin() as session:
        for user_id in (first_id, second_id):
            await UserDao.add(
                session,
                {
                    "id": user_id,
                    "username": str(user_id),
                    "email": f"{user_id}@example.com",
                    "password": "unused",
                },
            )

    ready = Barrier(2)

    async def open_chat(user_id: uuid.UUID, peer_id: uuid.UUID) -> uuid.UUID:
        async with sessions.begin() as session:
            await session.connection()
            await ready.wait()
            chat = await ChatDao.get_or_create_direct_chat(session, user_id, peer_id)
            assert {user.id for user in chat.users} == {user_id, peer_id}
            return chat.id

    try:
        async with TaskGroup() as group:
            first_chat = group.create_task(open_chat(first_id, second_id))
            second_chat = group.create_task(open_chat(second_id, first_id))
        assert first_chat.result() == second_chat.result()
    finally:
        async with sessions.begin() as session:
            await UserDao.delete_by_id(session, first_id)
            await UserDao.delete_by_id(session, second_id)


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


async def test_chat_member_roles_read_states_and_updates(
    db_session,
    db_user,
    db_userchat,
):
    chat, member = db_userchat
    message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "read me"},
        [],
    )

    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    assert await ChatDao.set_owner_role(db_session, chat.id, db_user.id) is True
    assert (
        await ChatDao.set_member_role(
            db_session,
            chat.id,
            member.id,
            "moderator",
        )
        is True
    )
    assert (
        await ChatDao.set_member_role(
            db_session,
            chat.id,
            uuid.uuid4(),
            "member",
        )
        is False
    )
    assert await ChatDao.get_member_roles(db_session, chat.id) == {
        db_user.id: "owner",
        member.id: "moderator",
    }

    assert await ChatDao.is_message_in_chat(db_session, chat.id, message.id) is True
    assert await ChatDao.is_message_in_chat(db_session, chat.id, uuid.uuid4()) is False
    read_at = datetime.now(timezone.utc).replace(tzinfo=None)
    await ChatDao.mark_read(db_session, chat.id, member.id, message.id, read_at)
    assert await ChatDao.get_read_states(db_session, chat.id) == {
        member.id: message.id,
    }

    updated = await ChatDao.update_chat_fields(
        db_session,
        chat.id,
        title="renamed chat",
        description="updated description",
    )
    assert updated.title == "renamed chat"
    assert updated.description == "updated description"
    assert (
        await ChatDao.update_chat_fields(
            db_session,
            uuid.uuid4(),
            title=None,
            description=None,
        )
        is None
    )
