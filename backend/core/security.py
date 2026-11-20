from datetime import datetime, timedelta, timezone
from typing import Annotated
import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
import jwt
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from sqlalchemy.ext.asyncio import AsyncSession

from config import get_settings
from db.dao.user_dao import UserDao
from db.models import User
from schemas.auth import UserLogin

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
password_hash = PasswordHash.recommended()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_hash.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)


async def authenticate_user(
    data: UserLogin,
    session: AsyncSession,
) -> User | None:
    user = await UserDao.get_by_email_case_insensitive(
        session=session,
        email=data.username.strip(),
    )
    if user is None:
        return None
    if not verify_password(data.password, user.password):
        return None
    return user


def create_access_token(
    data: dict[str, str | int | datetime],
    expires_delta: timedelta | None = None,
) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    settings = get_settings()
    encoded_jwt = jwt.encode(
        to_encode,
        settings.SECRET_KEY.get_secret_value(),
        algorithm=settings.ALGORITHM,
    )
    return encoded_jwt


async def get_id_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
) -> uuid.UUID:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY.get_secret_value(),
            algorithms=[settings.ALGORITHM],
        )
        sub_id = payload.get("sub")
        if sub_id is None or payload.get("purpose"):
            raise credentials_exception
        return uuid.UUID(sub_id)
    except (InvalidTokenError, KeyError, TypeError, ValueError):
        raise credentials_exception from None
