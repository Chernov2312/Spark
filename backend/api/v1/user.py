import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags, StorageClientMethod
from core.security import get_id_current_user
from core.storage import S3Storage
from core.user_tags import normalize_user_tag
from db.dao.attachment_dao import AttachmentDao
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models import User
from schemas.user import (
    Avatar,
    UserListResponse,
    UserQuery,
    UserRead,
    UserUpdate,
)

user_router = APIRouter(prefix="/api/v1/users", tags=[RouteTags.USERS])


async def _profile_response(user: User | None) -> UserRead:
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    avatar_urls: list[str] = []
    s3 = S3Storage()
    for avatar in user.avatars:
        if not avatar.file_key:
            continue
        url = await s3.get_temporary_url(
            file_key=avatar.file_key,
            client_method=StorageClientMethod.GET.value,
        )
        if url is not None:
            avatar_urls.append(url)
    return UserRead(
        id=user.id,
        username=user.username,
        tag=user.tag,
        email=user.email,
        avatar_urls=avatar_urls,
        created_at=user.created_at,
    )


@user_router.get("/me", status_code=status.HTTP_200_OK)
async def get_me(
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> UserRead:
    user = await UserDao.get_user_with_avatars(session=session, target_id=user_id)
    return await _profile_response(user)


@user_router.patch("/me", status_code=status.HTTP_200_OK)
async def update_me(
    update_user: UserUpdate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> UserRead:
    update_data = update_user.model_dump(exclude_unset=True)
    if "tag" in update_data:
        update_data["tag"] = normalize_user_tag(update_data["tag"])
        if len(update_data["tag"]) < 3:
            raise HTTPException(
                status_code=422,
                detail="Tag must contain at least 3 letters or digits",
            )
        existing_tag = await UserDao.get_by_tag(session, update_data["tag"])
        if existing_tag is not None and existing_tag.id != current_user_id:
            raise HTTPException(status_code=409, detail="This tag is already taken")
    user = await UserDao.update_by_id(
        session=session,
        target_id=current_user_id,
        data=update_data,
    )

    return await _profile_response(user)


@user_router.post("/me/delete/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def delete_avatar(
    avatar: Avatar,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> Response:
    image = await AttachmentDao.get_avatar_by_url_and_user_id(
        session=session,
        target_url=avatar.url,
        user_id=current_user_id,
    )
    if not image:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image not found or you are not the owner",
        )
    s3 = S3Storage()
    if not await s3.delete_file_by_key(file_key=avatar.url):
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Failed to delete image from storage",
        )
    await AttachmentDao.delete_by_id(session, image.id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@user_router.get("/search")
async def get_user_by_username(
    user: UserQuery = Query(...),
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
) -> UserListResponse:
    target = user.username.strip()
    if target.startswith("@"):
        target = normalize_user_tag(target)
    return UserListResponse(
        users=await UserDao.find_by_username(session=session, target=target),
    )
