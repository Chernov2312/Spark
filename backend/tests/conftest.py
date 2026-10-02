import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.config import settings
from backend.db.database import Base
from backend.main import app


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def db_engine():
    db_url = (
        f"postgresql+asyncpg://{settings.POSTGRES_USER}_test"
        f":{settings.POSTGRES_PASSWORD}_test"
        f"@localhost"
        f":{settings.POSTGRES_PORT}"
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
    async_session_maker = async_sessionmaker(db_engine, expire_on_commit=False)

    async with async_session_maker() as session:
        yield session
        await session.rollback()


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def api_client():
    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://localhost:8000/",
    ) as client:
        yield client
