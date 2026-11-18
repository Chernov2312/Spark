import uuid

from httpx2 import AsyncClient
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import create_access_token
from core.storage import S3Storage
from db.dao.chat_dao import ChatDao
from db.models import Attachment, Chat, User


@pytest.mark.parametrize("role", ["owner", "moderator", "member", "outsider"])
async def test_shared_avatar_upload_and_registration_require_an_editor(
    role: str,
    db_session: AsyncSession,
    db_user: User,
    db_userchat: tuple[Chat, User],
    minio_s3_storage: dict[str, str],
    api_client: AsyncClient,
) -> None:
    chat, member = db_userchat
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    if role == "moderator":
        await ChatDao.set_member_role(db_session, chat.id, member.id, role)
    requester = (
        db_user.id
        if role == "owner"
        else uuid.uuid4()
        if role == "outsider"
        else member.id
    )
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(requester)})}"}
    allowed = role in {"owner", "moderator"}
    response = await api_client.post(
        "/api/v1/attachments/temporary-url",
        headers=headers,
        json={
            "type": "chat_avatar",
            "target_id": str(chat.id),
            "file_extension": "png",
            "file_content": "image/png",
        },
    )
    assert response.status_code == (200 if allowed else 403)
    file_key = f"chat_avatar/{chat.id}/{uuid.uuid4().hex}.png"
    if allowed:
        upload = response.json()
        assert upload["chat_id"] == str(chat.id)
        assert upload["file_key"].startswith(f"chat_avatar/{chat.id}/")
        file_key = upload["file_key"]
        storage = S3Storage()
        async with storage.session.client("s3", **storage.config) as s3:
            await s3.put_object(
                Bucket=storage.bucket_name,
                Key=file_key,
                Body=b"png-bytes",
                ContentType="image/png",
            )
    saved = await api_client.post(
        "/api/v1/attachments/",
        headers=headers,
        json={
            "chat_id": str(chat.id),
            "is_avatar": True,
            "file_key": file_key,
            "file_name": "avatar.png",
            "file_size": 9,
            "mime_type": "image/png",
        },
    )
    assert saved.status_code == (200 if allowed else 403)
    count = await db_session.scalar(
        select(func.count())
        .select_from(Attachment)
        .where(
            Attachment.chat_id == chat.id,
            Attachment.is_avatar.is_(True),
        )
    )
    assert count == (1 if allowed else 0)


async def test_demoted_moderator_cannot_register_shared_avatar_but_can_set_a_personal_one(
    db_session: AsyncSession,
    db_userchat: tuple[Chat, User],
    minio_s3_storage: dict[str, str],
    api_client: AsyncClient,
) -> None:
    chat, member = db_userchat
    await ChatDao.set_member_role(db_session, chat.id, member.id, "moderator")
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(member.id)})}"}
    upload = await api_client.post(
        "/api/v1/attachments/temporary-url",
        headers=headers,
        json={
            "type": "chat_avatar",
            "target_id": str(chat.id),
            "file_extension": "png",
            "file_content": "image/png",
        },
    )
    assert upload.status_code == 200
    await ChatDao.set_member_role(db_session, chat.id, member.id, "member")
    saved = await api_client.post(
        "/api/v1/attachments/",
        headers=headers,
        json={
            "chat_id": str(chat.id),
            "is_avatar": True,
            "file_key": upload.json()["file_key"],
            "file_name": "avatar.png",
            "file_size": 9,
            "mime_type": "image/png",
        },
    )
    assert saved.status_code == 403
    personal = await api_client.post(
        "/api/v1/attachments/temporary-url",
        headers=headers,
        json={
            "type": "personal_chat_avatar",
            "target_id": str(chat.id),
            "file_extension": "png",
            "file_content": "image/png",
        },
    )
    assert personal.status_code == 200


@pytest.mark.parametrize(
    "target_id,expected_status", [("invalid", 422), (str(uuid.uuid4()), 404)]
)
async def test_shared_avatar_requires_a_valid_existing_chat(
    target_id: str,
    expected_status: int,
    db_user: User,
    api_client: AsyncClient,
) -> None:
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(db_user.id)})}"}
    response = await api_client.post(
        "/api/v1/attachments/temporary-url",
        headers=headers,
        json={
            "type": "chat_avatar",
            "target_id": target_id,
            "file_extension": "png",
            "file_content": "image/png",
        },
    )
    assert response.status_code == expected_status
