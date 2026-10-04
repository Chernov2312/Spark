from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
import hashlib

from config import RouteTags
from db.dao.user_dao import UserDao
from db.database import get_session
from schemas.auth import UserLogin, UserRegister, UserResponse

auth_router = APIRouter(prefix="/api/v1/auth", tags=[RouteTags.AUTH])


@auth_router.post("/register")
async def register(
    data: UserRegister,
    session: AsyncSession = Depends(get_session),
) -> UserResponse:

    exist = await UserDao.get_by_username_or_email(session, data.name)
    if exist:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="username already taken",
        )
    hashed_password = hashlib.sha256(data.password.encode()).hexdigest()
    new_user = await UserDao.add(
        session,
        {
            "username": data.name,
            "email": data.email,
            "password": hashed_password,
        },
    )
    await session.commit()

    return UserResponse(id=new_user.id, username=new_user.username)


@auth_router.post("/login")
async def login(data: UserLogin, session: AsyncSession = Depends(get_session)):
    user = UserRegister(UserDao.get_by_username(session, UserLogin.email))  # get by email
    if user is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="no such users")
    # здесь вероятно надо захэшировать data.password и сравнить с хэшом из бд
    # if user.password is data.password and user.email == data.email:
