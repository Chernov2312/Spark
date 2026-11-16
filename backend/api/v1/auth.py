from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
import jwt
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession
from tasks.email import send_mail_task

from config import RouteTags, settings
from core.security import (
    authenticate_user,
    create_access_token,
    get_password_hash,
)
from core.user_tags import normalize_user_tag
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models import User
from db.models.social import ChatFolder, FriendCategory
from schemas.auth import UserLogin, UserRegister, UserRegistrationResponse, UserResponse

auth_router = APIRouter(prefix="/api/v1/auth", tags=[RouteTags.AUTH])


@auth_router.get("/verification/{verification_token}")
async def verification(
    verification_token: str,
    session: AsyncSession = Depends(get_session),
):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(
            verification_token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        email = payload.get("sub")
        user_id = payload.get("user_id")
        exp = payload.get("exp")
        if email is None or exp is None or user_id is None:
            raise credentials_exception
        cur_user: User | None = await UserDao.get_by_username_or_email(
            session=session,
            target=email,
        )
        if cur_user is None or str(cur_user.id) != str(user_id):
            raise credentials_exception
        if not cur_user.is_verified:
            cur_user.is_verified = True
            await session.commit()
    except (InvalidTokenError, KeyError, TypeError):
        raise credentials_exception from None
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": str(cur_user.id)},
        expires_delta=access_token_expires,
    )
    return UserResponse(
        id=cur_user.id,
        username=cur_user.username,
        tag=cur_user.tag,
        email=email,
        access_token=access_token,
    )


@auth_router.post("/register", status_code=status.HTTP_201_CREATED)
async def register(
    data: UserRegister,
    session: AsyncSession = Depends(get_session),
) -> UserRegistrationResponse:

    if await UserDao.get_by_username_or_email(session, data.email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="email already registered",
        )
    if data.tag:
        tag = normalize_user_tag(data.tag)
        if len(tag) < 3:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Tag must contain at least 3 letters or digits",
            )
        if await UserDao.get_by_tag(session, tag):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This tag is already taken",
            )
    else:
        tag = await UserDao.available_tag(session, data.username)
    hashed_password = get_password_hash(data.password)
    new_user = await UserDao.add(
        session,
        {
            "username": data.username,
            "tag": tag,
            "email": data.email,
            "password": hashed_password,
        },
    )
    session.add_all(
        [
            FriendCategory(owner_id=new_user.id, name=name, is_default=True)
            for name in ("Коллеги", "Родители", "Знакомые")
        ]
        + [
            ChatFolder(owner_id=new_user.id, name=name, is_default=True)
            for name in ("Работа", "Друзья", "Семья")
        ],
    )
    send_mail_task.delay(
        new_user.email,
        new_user.username,
        str(new_user.id),
        settings.FRONTEND_BASE_URL,
    )
    return UserRegistrationResponse(
        id=new_user.id,
        username=new_user.username,
        tag=new_user.tag,
        email=new_user.email,
        verification_required=True,
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
        tag=user.tag,
        email=user.email,
        access_token=access_token,
    )
