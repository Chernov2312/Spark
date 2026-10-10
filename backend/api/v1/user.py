import uuid

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.dao.user_dao import UserDao
from db.database import get_session
from schemas.user import Avatar, UserRead, UserUpdate

user_router = APIRouter(prefix="/api/v1/users", tags=[RouteTags.USERS])
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


@user_router.get("/me", status_code=status.HTTP_200_OK)
async def get_me(
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> UserRead:
    return await UserDao.get_by_id(session=session, target_id=user_id)


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
    await session.commit()
    return user


@user_router.post("/me/avatar", status_code=status.HTTP_201_CREATED)
async def set_avatar(
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> Avatar:
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="incorrect file format",
        )
    s3 = S3Storage()
    url = await s3.upload_avatar(file=file, user_id=current_user_id)
    await AttachmentDao.add(
        session=session,
        data={"user_id": current_user_id, "image_url": url},
    )
    await session.commit()
    return Avatar(url=url)


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
    if not await s3.delete_avatar(file_url=avatar.url):
        await session.rollback()
        raise HTTPException(
            status_code=status.HTTP_504_GATEWAY_TIMEOUT,
            detail="Failed to delete image from storage",
        )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
