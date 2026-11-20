from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import hashlib
import secrets
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from core.security import create_access_token
from db.dao.refresh_session_dao import RefreshSessionDao


@dataclass(frozen=True)
class SessionTokens:
    access_token: str
    refresh_token: str
    expires_at: datetime


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _session_tokens(
    user_id: uuid.UUID, refresh_token: str, expires_at: datetime
) -> SessionTokens:
    access_token = create_access_token(
        {"sub": str(user_id), "jti": uuid.uuid4().hex},
        expires_delta=timedelta(minutes=get_settings().ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return SessionTokens(access_token, refresh_token, expires_at)


async def start_session(
    session: AsyncSession, user_id: uuid.UUID, previous_token: str | None
) -> SessionTokens:
    await revoke_session(session, previous_token)
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=get_settings().REFRESH_TOKEN_EXPIRE_DAYS)
    await RefreshSessionDao.create(session, user_id, _hash_token(token), expires_at, now)
    return _session_tokens(user_id, token, expires_at)


async def rotate_session(
    session: AsyncSession, refresh_token: str | None
) -> SessionTokens | None:
    if not refresh_token:
        return None
    new_token = secrets.token_urlsafe(32)
    current = await RefreshSessionDao.rotate(
        session,
        _hash_token(refresh_token),
        _hash_token(new_token),
        datetime.now(timezone.utc),
    )
    if current is None:
        return None
    user_id, expires_at = current
    return _session_tokens(user_id, new_token, expires_at)


async def revoke_session(session: AsyncSession, refresh_token: str | None) -> None:
    if refresh_token:
        await RefreshSessionDao.revoke(session, _hash_token(refresh_token))


async def revoke_user_sessions(session: AsyncSession, user_id: uuid.UUID) -> None:
    await RefreshSessionDao.revoke_for_user(session, user_id)
