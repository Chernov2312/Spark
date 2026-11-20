import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
from http.cookies import SimpleCookie
import uuid

from httpx2 import AsyncClient
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncEngine, AsyncSession

from config import get_settings
from core.auth_sessions import rotate_session, start_session
from core.security import create_access_token
from db.dao.refresh_session_dao import RefreshSessionDao
from db.dao.user_dao import UserDao
from db.models import RefreshSession

AUTH_PATH = "/api/v1/auth"
COOKIE_NAME = "spark_refresh_token"


def cookie_header(token: str) -> dict[str, str]:
    return {"Cookie": f"{COOKIE_NAME}={token}"}


async def test_login_rotates_refresh_cookie_and_logout_revokes_session(
    api_client: AsyncClient,
    db_session: AsyncSession,
    id_first_user: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(get_settings(), "FRONTEND_BASE_URL", "https://spark.example")
    auth_url = f"https://localhost:8001{AUTH_PATH}"
    login = await api_client.post(
        f"{auth_url}/login",
        data={"username": "alkash@mail.ru", "password": "Pivo228Chel"},
        headers={"Origin": "http://localhost:5174"},
    )
    assert login.status_code == 200
    assert login.headers["access-control-allow-origin"] == "http://localhost:5174"
    assert login.headers["access-control-allow-credentials"] == "true"
    assert login.headers["cache-control"] == "no-store"
    cookie = SimpleCookie(login.headers["set-cookie"])[COOKIE_NAME]
    assert cookie["httponly"]
    assert cookie["secure"]
    assert cookie["samesite"] == "lax"
    assert cookie["path"] == AUTH_PATH
    assert "refresh_token" not in login.json()
    stored = await db_session.scalar(
        select(RefreshSession).where(RefreshSession.user_id == id_first_user)
    )
    assert stored is not None
    assert stored.token_hash == hashlib.sha256(cookie.value.encode()).hexdigest()

    foreign_origin = await api_client.post(
        f"{auth_url}/refresh",
        headers={**cookie_header(cookie.value), "Origin": "https://untrusted.example"},
    )
    assert foreign_origin.status_code == 403

    refreshed = await api_client.post(f"{auth_url}/refresh")
    assert refreshed.status_code == 200
    new_cookie = SimpleCookie(refreshed.headers["set-cookie"])[COOKIE_NAME]
    assert new_cookie.value != cookie.value
    assert new_cookie["expires"] == cookie["expires"]
    assert refreshed.json()["access_token"] != login.json()["access_token"]
    me = await api_client.get(
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["id"] == str(id_first_user)
    replay = await api_client.post(
        f"{auth_url}/refresh", headers=cookie_header(cookie.value)
    )
    assert replay.status_code == 401
    assert "set-cookie" not in replay.headers

    logout = await api_client.post(f"{auth_url}/logout")
    assert logout.status_code == 204
    assert SimpleCookie(logout.headers["set-cookie"])[COOKIE_NAME]["max-age"] == "0"
    assert (
        await api_client.post(
            f"{auth_url}/refresh", headers=cookie_header(new_cookie.value)
        )
    ).status_code == 401
    assert (await api_client.post(f"{auth_url}/logout")).status_code == 204


async def test_expired_refresh_token_and_password_reset(
    api_client: AsyncClient, db_session: AsyncSession, id_first_user: uuid.UUID
) -> None:
    now = datetime.now(timezone.utc)
    first = await start_session(db_session, id_first_user, None)
    second = await start_session(db_session, id_first_user, None)
    expired_token = "expired-session"
    await RefreshSessionDao.create(
        db_session,
        id_first_user,
        hashlib.sha256(expired_token.encode()).hexdigest(),
        now - timedelta(seconds=1),
        now,
    )
    expired = await api_client.post(
        f"{AUTH_PATH}/refresh", headers=cookie_header(expired_token)
    )
    assert expired.status_code == 401
    reset_token = create_access_token(
        {
            "sub": "alkash@mail.ru",
            "user_id": str(id_first_user),
            "purpose": "password_reset",
            "jti": uuid.uuid4().hex,
        }
    )
    assert (
        await api_client.get(f"{AUTH_PATH}/verification/{reset_token}")
    ).status_code == 401
    result = await api_client.post(
        f"{AUTH_PATH}/password/reset",
        json={"token": reset_token, "password": "NewValidPassword123"},
    )
    assert result.status_code == 200
    for token in (first.refresh_token, second.refresh_token):
        assert (
            await api_client.post(f"{AUTH_PATH}/refresh", headers=cookie_header(token))
        ).status_code == 401
    assert (
        await db_session.scalar(
            select(RefreshSession).where(RefreshSession.user_id == id_first_user)
        )
        is None
    )


async def test_only_one_concurrent_refresh_rotates_token(db_engine: AsyncEngine) -> None:
    sessions = async_sessionmaker(db_engine, expire_on_commit=False)
    user_id = uuid.uuid4()
    async with sessions.begin() as session:
        user = await UserDao.add(
            session,
            {
                "id": user_id,
                "username": "concurrent-session",
                "email": f"{user_id}@example.com",
                "password": "unused",
            },
        )
        tokens = await start_session(session, user.id, None)

    async def rotate() -> bool:
        async with sessions.begin() as session:
            return await rotate_session(session, tokens.refresh_token) is not None

    try:
        assert sorted(await asyncio.gather(rotate(), rotate())) == [False, True]
    finally:
        async with sessions.begin() as session:
            await UserDao.delete_by_id(session, user.id)
