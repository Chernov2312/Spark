import pytest_asyncio

from db.dao.user_dao import UserDao


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def db_user(db_session):
    test_user = {"username": "test", "password": "test1234", "email": "test@mail.ru"}
    user = await UserDao.add(session=db_session, data=test_user)
    yield user


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def db_userchat(db_session):
    test_user = {"username": "test", "password": "test1234", "email": "test@mail.ru"}
    user = await UserDao.add(session=db_session, data=test_user)
    yield user
