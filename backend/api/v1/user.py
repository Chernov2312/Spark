import uuid

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags, StorageClientMethod
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.dao.user_dao import UserDao
from db.database import get_session
from schemas.user import Avatar, UserRead, UserUpdate

user_router = APIRouter(prefix="/api/v1/users", tags=[RouteTags.USERS])


@user_router.get("/me", status_code=status.HTTP_200_OK)
async def get_me(
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> UserRead:
    user = await UserDao.get_user_with_avatars(session=session, target_id=user_id)
    avatar_urls = []
    s3 = S3Storage()
    for i in user.avatars:
        avatar_urls.append(
            await s3.get_temporary_url(
                file_key=i.attachment_url,
                client_method=StorageClientMethod.GET.value,
            ),
        )
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        avatar_urls=avatar_urls,
        created_at=user.created_at,
    )


@user_router.patch("/me", status_code=status.HTTP_200_OK)
async def update_me(
    update_user: UserUpdate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> UserRead:
    user: UserRead = await UserDao.update_by_id(
        session=session,
        target_id=current_user_id,
        data=update_user.model_dump(exclude_unset=True),
    )

    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    avatar_urls = []
    s3 = S3Storage()
    for i in user.avatars:
        avatar_urls.append(await s3.get_temporary_url(i.attachment_url))
    await session.commit()
    return UserRead(
        id=user.id,
        username=user.username,
        email=user.email,
        avatar_urls=avatar_urls,
        created_at=user.created_at,
    )


@user_router.post("/me/delete/avatar", status_code=status.HTTP_204_NO_CONTENT)
async def delete_avatar(
    avatar: Avatar,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    image = await AttachmentDao.delete_attachment_by_url_and_user_id(
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
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Failed to delete image from storage",
        )
    return Response(status_code=status.HTTP_204_NO_CONTENT)
