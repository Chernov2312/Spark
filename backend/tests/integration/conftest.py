import pytest_asyncio

from db.dao.chat_dao import ChatDao
from db.dao.user_dao import UserDao


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def db_user(db_session):
    test_user = {"username": "test", "password": "test1234", "email": "test@mail.ru"}
    user = await UserDao.add(session=db_session, data=test_user)
    yield user


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def db_userchat(db_session, db_user):
    test_user = {"username": "test2", "password": "test1234", "email": "test2@mail.ru"}
    user = await UserDao.add(session=db_session, data=test_user)
    chat = await ChatDao.add(
        db_session,
        {"owner_id": db_user.id, "title": "test", "description": "test"},
    )
    chat = await ChatDao.add_users_to_chat(
        session=db_session,
        chat_id=chat.id,
        new_user_ids=[user.id],
    )
    yield (chat, user)
