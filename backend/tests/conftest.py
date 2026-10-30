from unittest.mock import patch

import pytest_asyncio
import redis.asyncio as aioredis
from httpx import ASGITransport, AsyncClient
from main import app
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from config import settings
from core.security import create_access_token, get_password_hash
from db.dao.user_dao import UserDao
from db.database import Base, get_session
from db.models.attachment import Attachment
from db.models.chat import Chat
from db.models.message import Message
from db.models.message_reaction import MessageReaction
from db.models.user import User

__all__ = (
    "Chat",
    "Attachment",
    "Message",
    "MessageReaction",
    "User",
)


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_engine():
    db_url = (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}"
        f":{settings.POSTGRES_PASSWORD}"
        f"@{settings.POSTGRES_HOST}"
        f":{settings.POSTGRES_PORT}"
        f"/{settings.POSTGRES_DB}"
    )
    engine = create_async_engine(url=db_url)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, checkfirst=True)

    await engine.dispose()


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def db_session(db_engine):
    async with db_engine.connect() as connection:
        transaction = await connection.begin()

        async_session_maker = async_sessionmaker(
            bind=connection,
            expire_on_commit=False,
        )

        async with async_session_maker() as session:
            yield session
        await transaction.rollback()


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def test_redis_client():
    app.state.redis = aioredis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
    )
    yield
    await app.state.redis.aclose()


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def api_client(db_session, test_redis_client):
    app.dependency_overrides[get_session] = lambda: db_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://localhost:8001/",
    ) as client:
        yield client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def id_first_user(db_session):
    new_user = {
        "username": "ivan_natanich",
        "email": "alkash@mail.ru",
        "password": get_password_hash("Pivo228Chel"),
        "is_verified": True,
    }
    user = await UserDao.add(session=db_session, data=new_user)
    await db_session.flush()
    yield user.id


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def auth_token_and_user(id_first_user):
    token = create_access_token({"sub": str(id_first_user)})

    yield token


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def id_second_user(db_session):
    new_user = {
        "username": "ivan_nih_natanich",
        "email": "alkash_pivo@mail.ru",
        "password": get_password_hash("Pivo228Chel"),
    }
    user = await UserDao.add(session=db_session, data=new_user)
    await db_session.flush()
    yield user.id


@pytest_asyncio.fixture(autouse=True)
async def mock_email_task():
    with patch("api.v1.auth.send_mail_task.delay") as mock:
        yield mock
