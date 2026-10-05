from datetime import datetime, timedelta, timezone
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from jwt import InvalidTokenError
from pwdlib import PasswordHash
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models import User
from schemas.auth import UserLogin

security_router = APIRouter()

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")
password_hash = PasswordHash.recommended()


class Token(BaseModel):
    access_token: str
    token_type: str


class TokenData(BaseModel):
    id: str
    username: str | None = None


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return password_hash.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)


async def authenticate_user(
    data: UserLogin,
    session: AsyncSession,
):
    user = await UserDao.get_by_username_or_email(session=session, target=data.email)
    if not user:
        return False
    if not verify_password(data.password, user.password):
        return False
    return user


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        sub_id = payload.get("sub")
        if sub_id is None:
            raise credentials_exception
    except (InvalidTokenError, KeyError, TypeError):
        raise credentials_exception
    user = await UserDao.get_by_id(session=session, target_id=sub_id)
    return user


@security_router.post("/token", response_model=Token)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Token:
    user = await authenticate_user(
        UserLogin(password=form_data.password, email=form_data.username),
        session=session,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.id), "username": user.username},
        expires_delta=access_token_expires,
    )
    return Token(access_token=access_token, token_type="bearer")
