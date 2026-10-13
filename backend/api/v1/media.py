import uuid

from fastapi import APIRouter, Depends, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.database import get_session
from schemas.attachment import AttachmentResponse

attachment_router = APIRouter(prefix="/api/v1/attachments", tags=[RouteTags.ATTACHMENT])


@attachment_router.post("/")
async def create_attachment(
    file: UploadFile,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> AttachmentResponse:
    s3 = S3Storage()
    url = await s3.upload_avatar(file=file, user_id=user_id)
    res = await AttachmentDao.add(
        session=session,
        data={
            "user_id": user_id,
            "attachment_url": url,
            "mime_type": file.content_type,
            "file_name": file.filename,
            "file_size": file.size,
        },
    )
    await session.commit()
    return res
