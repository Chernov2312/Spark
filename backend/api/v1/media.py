import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags, StorageCategory, StorageClientMethod
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.database import get_session
from schemas.attachment import (
    AttachmentRequest,
    AttachmentResponse,
    AvatarUrlRequest,
    AvatarUrlResponse,
)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
attachment_router = APIRouter(prefix="/api/v1/attachments", tags=[RouteTags.ATTACHMENT])


@attachment_router.post("/temporary-url")
async def get_temprorary_url_for_create_media(
    data: AvatarUrlRequest,
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> AvatarUrlResponse:
    s3 = S3Storage()
    if data.type == "message":
        file_key = s3.create_file_key(
            file_extension=data.file_extension,
            target_id=user_id,
            category=StorageCategory.USER_MESSAGE.value,
        )
    elif data.type == "user_avatar":
        if data.file_content not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="incorrect file format",
            )
        file_key = s3.create_file_key(
            file_extension=data.file_extension,
            target_id=user_id,
            category=StorageCategory.USER_AVATAR.value,
        )
        temporary_url = await s3.get_temporary_url(
            file_key=file_key,
            client_method=StorageClientMethod.PUT.value,
        )
        return AvatarUrlResponse(
            user_id=user_id,
            temporary_url=temporary_url,
            file_key=file_key,
        )
    elif data.type == "chat_avatar":
        if data.file_content not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="incorrect file format",
            )
        chat_id = uuid.uuid4()
        file_key = s3.create_file_key(
            file_extension=data.file_extension,
            target_id=chat_id,
            category=StorageCategory.CHAT_AVATAR.value,
        )
        temporary_url = await s3.get_temporary_url(
            file_key=file_key,
            client_method=StorageClientMethod.PUT.value,
        )
        return AvatarUrlResponse(
            chat_id=chat_id,
            temporary_url=temporary_url,
            file_key=file_key,
        )


@attachment_router.post("/")
async def create_attachment(
    data_req: AttachmentRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> AttachmentResponse:
    s3 = S3Storage()
    if data_req.chat_id is None:
        data = {
            "user_id": user_id,
            "attachment_url": data_req.file_key,
            "is_avatar": data_req.is_avatar,
            "mime_type": data_req.mime_type,
            "file_name": data_req.file_name,
            "file_size": data_req.file_size,
        }
    else:
        data = {
            "chat_id": data_req.chat_id,
            "attachment_url": data_req.file_key,
            "is_avatar": data_req.is_avatar,
            "mime_type": data_req.mime_type,
            "file_name": data_req.file_name,
            "file_size": data_req.file_size,
        }

    res = await AttachmentDao.add(
        session=session,
        data=data,
    )
    temporary_url = await s3.get_temporary_url(
        res.attachment_url,
        client_method=StorageClientMethod.GET.value,
    )
    return AttachmentResponse(
        id=res.id,
        attachment_url=temporary_url,
        file_name=res.file_name,
        file_size=res.file_size,
        mime_type=res.mime_type,
        text=res.text,
        user_id=res.user_id,
        chat_id=res.chat_id,
    )
