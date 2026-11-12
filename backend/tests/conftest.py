from unittest.mock import patch
from uuid import uuid4

import aioboto3
import pytest
import pytest_asyncio
import redis.asyncio as aioredis
from botocore.client import Config
from httpx2 import ASGITransport, AsyncClient
from main import app
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from testcontainers.core.container import DockerContainer
from testcontainers.core.waiting_utils import wait_for_logs
from testcontainers.postgres import PostgresContainer
from testcontainers.redis import RedisContainer

from config import yandex_storage
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
async def db_engine(postgres_container):
    db_url = postgres_container.get_connection_url(driver="asyncpg")
    engine = create_async_engine(url=db_url)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all, checkfirst=True)

    await engine.dispose()


@pytest.fixture(scope="session")
def postgres_container():
    with PostgresContainer("postgres:15-alpine") as container:
        yield container


@pytest.fixture(scope="session")
def redis_container():
    with RedisContainer("redis:7-alpine") as container:
        yield container


@pytest.fixture(scope="session")
def minio_container():
    container = (
        DockerContainer("ghcr.io/coollabsio/minio:RELEASE.2025-10-15T17-29-55Z")
        .with_exposed_ports("9000/tcp")
        .with_env("MINIO_ROOT_USER", "spark-test-access")
        .with_env("MINIO_ROOT_PASSWORD", "spark-test-secret-key")
        .with_command("server /data --console-address :9001")
    )
    with container as started:
        wait_for_logs(started, "API:")
        yield started


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def minio_s3_storage(minio_container, monkeypatch):
    endpoint = (
        f"http://{minio_container.get_container_host_ip()}:"
        f"{minio_container.get_exposed_port(9000)}"
    )
    access_key = "spark-test-access"
    secret_key = "spark-test-secret-key"
    bucket_name = f"spark-test-{uuid4().hex}"
    monkeypatch.setattr(yandex_storage, "YANDEX_CLOUD_KEY_ID", access_key)
    monkeypatch.setattr(yandex_storage, "YANDEX_CLOUD_KEY", secret_key)
    monkeypatch.setattr(yandex_storage, "BUCKET_NAME", bucket_name)
    monkeypatch.setattr(yandex_storage, "ENDPOINT_URL", endpoint)

    config = Config(
        signature_version="s3v4",
        region_name="ru-central1",
        s3={"addressing_style": "path"},
    )
    async with aioboto3.Session().client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=config,
    ) as s3:
        await s3.create_bucket(Bucket=bucket_name)
    yield {"endpoint": endpoint, "bucket_name": bucket_name}


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
async def test_redis_client(redis_container):
    redis_url = (
        f"redis://{redis_container.get_container_host_ip()}:"
        f"{redis_container.get_exposed_port(6379)}"
    )
    app.state.redis = aioredis.Redis.from_url(
        redis_url,
        decode_responses=True,
    )
    await app.state.redis.flushdb()
    yield app.state.redis
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
