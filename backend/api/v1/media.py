import uuid

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags, StorageCategory
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.database import get_session
from schemas.attachment import AttachmentResponse, AvatarRequest

attachment_router = APIRouter(prefix="/api/v1/attachments", tags=[RouteTags.ATTACHMENT])


@attachment_router.post("/")
async def create_attachment(
    file: UploadFile,
    data_req: AvatarRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> AttachmentResponse:
    s3 = S3Storage()
    if AvatarRequest.chat_id is None:
        url = await s3.upload_file(
            file=file,
            target_id=user_id,
            category=StorageCategory.USER_MESSAGE.value,
        )
        data = {
            "user_id": user_id,
            "attachment_url": url,
            "mime_type": file.content_type,
            "file_name": file.filename,
            "file_size": file.size,
        }
    else:
        url = await s3.upload_file(
            file=file,
            target_id=data_req.chat_id,
            category=StorageCategory.CHAT_AVATAR.value,
        )
        data = (
            {
                "chat_id": data_req.chat_id,
                "attachment_url": url,
                "mime_type": file.content_type,
                "file_name": file.filename,
                "file_size": file.size,
            },
        )

    res = await AttachmentDao.add(
        session=session,
        data=data,
    )
    temporary_url = await s3.get_temporary_url(res.attachment_url)
    if data_req.user_id is not None:
        return AttachmentResponse(
            id=res.id,
            attachment_url=temporary_url,
            user_id=res.user_id,
            file_name=res.file_name,
            file_size=res.file_size,
            mime_type=res.mime_type,
        )
    else:
        return AttachmentResponse(
            id=res.id,
            attachment_url=temporary_url,
            chat_id=res.chat_id,
            file_name=res.file_name,
            file_size=res.file_size,
            mime_type=res.mime_type,
        )
