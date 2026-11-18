import re
import uuid

from botocore.exceptions import ClientError
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.message_actions import ensure_chat_member
from core.storage import S3Storage
from db.dao.chat_appearance_dao import ChatAppearanceDao
from db.dao.chat_dao import ChatDao
from schemas.attachment import AvatarUrlResponse
from schemas.chats import ChatPersonalAvatarResponse

IMAGE_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}


async def ensure_shared_avatar_editor(
    session: AsyncSession,
    user_id: uuid.UUID,
    chat_id: uuid.UUID,
) -> None:
    chat = await ChatDao.get_chat_with_users(session, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    if chat.owner_id == user_id:
        return
    roles = await ChatDao.get_member_roles(session, chat_id)
    if (
        not any(member.id == user_id for member in chat.users)
        or roles.get(user_id) != "moderator"
    ):
        raise HTTPException(
            status_code=403,
            detail="Only the chat owner or moderators can change the chat avatar",
        )


async def create_personal_avatar_upload(
    session: AsyncSession,
    user_id: uuid.UUID,
    chat_id: uuid.UUID,
    mime_type: str,
) -> AvatarUrlResponse:
    await ensure_chat_member(session, chat_id, user_id)
    if mime_type not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=422, detail="Unsupported image type")
    file_key = (
        f"personal_chat_avatar/{user_id}/{chat_id}/"
        f"{uuid.uuid4().hex}.{IMAGE_EXTENSIONS[mime_type]}"
    )
    url = await S3Storage().get_temporary_url(file_key, client_method="put_object")
    return AvatarUrlResponse(
        user_id=user_id, chat_id=chat_id, file_key=file_key, temporary_url=url
    )


async def set_personal_avatar(
    session: AsyncSession,
    user_id: uuid.UUID,
    chat_id: uuid.UUID,
    file_key: str,
) -> ChatPersonalAvatarResponse:
    await ensure_chat_member(session, chat_id, user_id)
    prefix = f"personal_chat_avatar/{user_id}/{chat_id}/"
    if not re.fullmatch(
        re.escape(prefix) + r"[0-9a-f]{32}\.(jpg|png|webp|gif)", file_key
    ):
        raise HTTPException(status_code=422, detail="Invalid personal avatar key")
    storage = S3Storage()
    try:
        async with storage.session.client("s3", **storage.config) as s3:
            metadata = await s3.head_object(Bucket=storage.bucket_name, Key=file_key)
    except ClientError as error:
        if error.response["Error"]["Code"] in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(
                status_code=422, detail="Upload the image first"
            ) from None
        raise HTTPException(
            status_code=502, detail="Cannot read uploaded image"
        ) from None
    if metadata.get("ContentType") not in IMAGE_EXTENSIONS:
        raise HTTPException(status_code=422, detail="Unsupported image type")
    if not 0 < metadata.get("ContentLength", 0) <= 5 * 1024 * 1024:
        raise HTTPException(
            status_code=422, detail="Image must be between 1 byte and 5 MB"
        )
    url = await storage.get_temporary_url(file_key)
    await ChatAppearanceDao.set_avatar(session, user_id, chat_id, file_key)
    return ChatPersonalAvatarResponse(personal_avatar_url=url)


async def clear_personal_avatar(
    session: AsyncSession,
    user_id: uuid.UUID,
    chat_id: uuid.UUID,
) -> ChatPersonalAvatarResponse:
    await ensure_chat_member(session, chat_id, user_id)
    await ChatAppearanceDao.clear_avatar(session, user_id, chat_id)
    return ChatPersonalAvatarResponse()
