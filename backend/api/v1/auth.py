from datetime import datetime, timedelta, timezone
import hashlib
from typing import Annotated
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
import jwt
from jwt import InvalidTokenError
from sqlalchemy.ext.asyncio import AsyncSession
from tasks.email import send_mail_task, send_password_reset_mail_task

from config import RouteTags, settings
from core.dependencies import get_redis
from core.security import (
    authenticate_user,
    create_access_token,
    get_password_hash,
)
from core.user_tags import normalize_user_tag
from db.dao.social_dao import SocialDao
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models import User
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.auth import (
    PasswordResetConfirm,
    PasswordResetRequest,
    UserLogin,
    UserRegister,
    UserRegistrationResponse,
    UserResponse,
)
from schemas.responses import PasswordResetMessageResponse

auth_router = APIRouter(prefix="/api/v1/auth", tags=[RouteTags.AUTH])


@auth_router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED)
async def request_password_reset(
    data: PasswordResetRequest,
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> PasswordResetMessageResponse:
    normalized_email = str(data.email).strip().casefold()
    email_hash = hashlib.sha256(normalized_email.encode()).hexdigest()
    allowed = await RedisDao.set_once(
        redis,
        f"password-reset:request:{email_hash}",
        "1",
        expiration_seconds=60,
    )
    if allowed:
        user = await UserDao.get_by_email_case_insensitive(session, normalized_email)
        if user is not None:
            send_password_reset_mail_task.delay(
                user.email,
                user.username,
                str(user.id),
                settings.FRONTEND_BASE_URL,
            )
    return PasswordResetMessageResponse(
        message="If an account with this email exists, a password reset link will be sent.",
    )


@auth_router.post("/password/reset")
async def reset_password(
    data: PasswordResetConfirm,
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> PasswordResetMessageResponse:
    invalid_link = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Password reset link is invalid or expired",
    )
    try:
        payload = jwt.decode(
            data.token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        if payload.get("purpose") != "password_reset":
            raise invalid_link
        user_id = uuid.UUID(payload.get("user_id", ""))
        token_email = payload.get("sub")
        token_id = payload.get("jti")
        expires_at = payload.get("exp")
        if not token_email or not token_id or not expires_at:
            raise invalid_link
    except (InvalidTokenError, TypeError, ValueError, KeyError):
        raise invalid_link from None

    user = await UserDao.get_by_id(session, user_id)
    if user is None or user.email.casefold() != token_email.casefold():
        raise invalid_link

    remaining_seconds = max(
        1,
        int(expires_at - datetime.now(timezone.utc).timestamp()),
    )
    token_consumed = await RedisDao.set_once(
        redis,
        f"password-reset:used:{token_id}",
        "1",
        expiration_seconds=remaining_seconds,
    )
    if not token_consumed:
        raise invalid_link

    await UserDao.reset_password(
        session,
        user_id,
        get_password_hash(data.password),
    )
    return PasswordResetMessageResponse(
        message="Password has been reset. You can sign in with the new password.",
    )


@auth_router.get("/verification/{verification_token}")
async def verification(
    verification_token: str,
    session: AsyncSession = Depends(get_session),
) -> UserResponse:
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
            cur_user = await UserDao.mark_verified(session, cur_user.id)
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
    await SocialDao.add_default_groups(session, new_user.id)
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
    user: User | None = await authenticate_user(
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
