from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags, settings
from core.security import (
    authenticate_user,
    create_access_token,
    get_password_hash,
)
from db.dao.user_dao import UserDao
from db.database import get_session
from schemas.auth import (
    UserLogin,
    UserLoginResponse,
    UserRegister,
    UserRegisterResponse,
)

auth_router = APIRouter(prefix="/api/v1/auth", tags=[RouteTags.AUTH])


@auth_router.post("/register")
async def register(
    data: UserRegister,
    session: AsyncSession = Depends(get_session),
) -> UserRegisterResponse:

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

    return UserRegisterResponse(id=new_user.id, username=new_user.username)


@auth_router.post("/login")
async def login(
    data: UserLogin,
    session: AsyncSession = Depends(get_session),
) -> UserLoginResponse:
    user = await authenticate_user(data, session)

    if not user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="invalid email or password",
        )

    # выдаем jwt
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user.username},
        expires_delta=access_token_expires,
    )

    return UserLoginResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        token=access_token,
    )
