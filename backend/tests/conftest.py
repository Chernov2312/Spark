import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.config import settings
from backend.main import app
from core.security import create_access_token, get_password_hash
from db.dao.user_dao import UserDao
from db.database import Base, get_session
from db.models.chat import Chat
from db.models.attachment import Attachment
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
        f"postgresql+asyncpg://{settings.POSTGRES_USER}_test"
        f":{settings.POSTGRES_PASSWORD}_test"
        f"@localhost"
        f":5433"
        f"/{settings.POSTGRES_DB}_test"
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
async def api_client(db_session):
    app.dependency_overrides[get_session] = lambda: db_session
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://localhost:8000/",
    ) as client:
        yield client
    app.dependency_overrides.clear()


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def id_first_user(db_session):
    new_user = {
        "username": "ivan_natanich",
        "email": "alkash@mail.ru",
        "password": get_password_hash("Pivo228Chel"),
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
