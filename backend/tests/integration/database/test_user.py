import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.chat_dao import ChatDao
from db.dao.user_dao import UserDao
from db.models import Chat, Message, User


async def test_create_user(db_session):
    test_user = {"username": "chel", "password": "12345678", "email": "re@mail.ru"}
    user = await UserDao.add(session=db_session, data=test_user)
    assert test_user.get("username") == user.username
    assert test_user.get("email") == user.email
    assert test_user.get("password") == user.password


async def test_get_user(db_session, db_user: User):
    user_get = await UserDao.get_by_id(db_session, db_user.id)
    assert user_get.username == db_user.username
    assert user_get.email == db_user.email


async def test_get_by_username_or_email(db_session, db_user: User):
    user_username = await UserDao.get_by_username_or_email(db_session, db_user.username)
    assert user_username.id == db_user.id
    user_email = await UserDao.get_by_username_or_email(db_session, db_user.email)
    assert user_email.id == db_user.id


async def test_update_user(db_session, db_user: User):
    test = db_user.to_dict()
    test["username"] = "chel"
    user_get = await UserDao.update_by_id(db_session, target_id=db_user.id, data=test)
    assert user_get.username == test["username"]


async def test_get_users_from_chat(
    db_session,
    db_user: User,
    db_userchat: tuple[Chat, User],
):
    db_user_from_chat = db_userchat[1]
    db_userchat = db_userchat[0]
    chat = await ChatDao.get_chat_with_users(session=db_session, chat_id=db_userchat.id)
    assert db_user_from_chat.id == chat.users[0].id


async def test_case_insensitive_email_password_reset_and_verification(
    db_session,
    db_user: User,
):
    assert (
        await UserDao.get_by_email_case_insensitive(db_session, db_user.email.upper())
    ).id == db_user.id
    assert (
        await UserDao.get_by_email_case_insensitive(
            db_session,
            "missing@example.com",
        )
        is None
    )

    updated = await UserDao.reset_password(db_session, db_user.id, "new-hash")
    assert updated.password == "new-hash"
    assert await UserDao.reset_password(db_session, uuid.uuid4(), "unused") is None

    verified = await UserDao.mark_verified(db_session, db_user.id)
    assert verified.is_verified is True


async def test_delete_all_with_messages(
    db_session: AsyncSession, db_userchat: tuple[Chat, User]
) -> None:
    chat, member = db_userchat
    db_session.add(Message(user_id=member.id, chat_id=chat.id, text="test message"))
    await db_session.flush()
    # A caller can roll back the whole cleanup, including its dependent messages.
    transaction = await db_session.begin_nested()
    assert await UserDao.delete_all_with_messages(db_session) == 2
    await transaction.rollback()
    assert await db_session.scalar(select(func.count()).select_from(User)) == 2
    assert await db_session.scalar(select(func.count()).select_from(Message)) == 1

    assert await UserDao.delete_all_with_messages(db_session) == 2
    assert await db_session.scalar(select(func.count()).select_from(User)) == 0
    assert await db_session.scalar(select(func.count()).select_from(Message)) == 0
    assert await db_session.scalar(select(func.count()).select_from(Chat)) == 0
    assert await UserDao.delete_all_with_messages(db_session) == 0
