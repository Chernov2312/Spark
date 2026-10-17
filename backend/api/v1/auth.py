from datetime import timedelta
from typing import Annotated

import jwt
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession
from core.send_email import send_verification_email

from config import RouteTags, settings
from core.security import (
    authenticate_user,
    create_access_token,
    get_password_hash,
)
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models import User
from schemas.auth import (
    GetVerificationResponse,
    UserLogin,
    UserRegister,
    UserResponse,
)

auth_router = APIRouter(prefix="/api/v1/auth", tags=[RouteTags.AUTH])


@auth_router.get("/verification/{verification_token}")
async def verification(
    verification_token: str,
    session: AsyncSession = Depends(get_session),
) -> GetVerificationResponse:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            verification_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM],
        )
        email = payload.get("sub")
        exp = payload.get("exp")
        if email is None or exp is None:
            raise credentials_exception
        else:
            cur_user: User = await UserDao.get_by_username_or_email(
                session=session, target=email,
            )
            cur_user.is_verified = True

            session.commit()
    except (InvalidTokenError, KeyError, TypeError):
        raise credentials_exception


@auth_router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    data: UserRegister,
    session: AsyncSession = Depends(get_session),
) -> UserResponse:

    exist = await UserDao.get_by_username_or_email(session, data.username)
    if exist:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="username already taken",
        )
    hashed_password = get_password_hash(data.password)
    new_user = await UserDao.add(
        session,
        {
            "username": data.username,
            "email": data.email,
            "password": hashed_password,
        },
    )
    await session.commit()

    send_verification_email(user_email=data.email, session=session)

    return UserResponse(
        id=new_user.id,
        username=new_user.username,
        email=new_user.email,
        access_token="",
    )


@auth_router.post("/login", status_code=status.HTTP_200_OK)
async def login_for_access_token(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserResponse:
    user: User = await authenticate_user(
        UserLogin(password=form_data.password, username=form_data.username),
        session=session,
    )
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if not user.is_verified:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Unverifeied email adress",
        )

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=access_token_expires,
    )
    return UserResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        access_token=access_token,
    )
