import uuid

from fastapi import HTTPException
import pytest
from sqlalchemy import delete, func, select

from api.v1.chats import get_chats
from core.chat_appearance import (
    create_personal_avatar_upload,
    set_personal_avatar,
)
from core.security import create_access_token
from core.storage import S3Storage
from db.dao.chat_appearance_dao import ChatAppearanceDao
from db.dao.chat_dao import ChatDao
from db.models import ChatAppearance, user_chat
from schemas.attachment import AvatarUrlResponse


async def test_appearance_upsert_is_private_and_clears_independently(
    db_session, db_userchat, db_user
):
    chat, member = db_userchat
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    await ChatAppearanceDao.set_avatar(db_session, member.id, chat.id, "first.png")
    await ChatAppearanceDao.set_avatar(db_session, member.id, chat.id, "second.png")
    await ChatAppearanceDao.set_avatar(db_session, db_user.id, chat.id, "other.png")
    assert await ChatAppearanceDao.get_avatar_keys(db_session, member.id, {chat.id}) == {
        chat.id: "second.png"
    }
    assert (
        await ChatAppearanceDao.get_avatar_keys(db_session, uuid.uuid4(), {chat.id}) == {}
    )
    assert await ChatAppearanceDao.get_avatar_keys(db_session, member.id, set()) == {}
    assert await db_session.scalar(select(func.count()).select_from(ChatAppearance)) == 2
    await ChatAppearanceDao.clear_avatar(db_session, member.id, chat.id)
    await ChatAppearanceDao.clear_avatar(db_session, member.id, chat.id)
    assert await ChatAppearanceDao.get_avatar_keys(db_session, member.id, {chat.id}) == {}
    assert await ChatAppearanceDao.get_avatar_keys(db_session, db_user.id, {chat.id}) == {
        chat.id: "other.png"
    }
    await db_session.execute(
        delete(user_chat).where(
            user_chat.c.user_id == db_user.id, user_chat.c.chat_id == chat.id
        )
    )
    assert (
        await ChatAppearanceDao.get_avatar_keys(db_session, db_user.id, {chat.id}) == {}
    )


async def test_personal_avatar_upload_persists_for_only_one_user(
    db_session,
    db_userchat,
    db_user,
    minio_s3_storage,
    test_redis_client,
    api_client,
):
    chat, member = db_userchat
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    headers = {"Authorization": f"Bearer {create_access_token({'sub': str(member.id)})}"}
    upload_response = await api_client.post(
        "/api/v1/attachments/temporary-url",
        headers=headers,
        json={
            "type": "personal_chat_avatar",
            "target_id": str(chat.id),
            "file_extension": "png",
            "file_content": "image/png",
        },
    )
    assert upload_response.status_code == 200
    upload = AvatarUrlResponse.model_validate(upload_response.json())
    assert upload.file_key.startswith(f"personal_chat_avatar/{member.id}/{chat.id}/")
    storage = S3Storage()
    async with storage.session.client("s3", **storage.config) as s3:
        await s3.put_object(
            Bucket=storage.bucket_name,
            Key=upload.file_key,
            Body=b"png-bytes",
            ContentType="image/png",
        )
    saved = await api_client.put(
        f"/api/v1/chats/{chat.id}/personal-avatar",
        headers=headers,
        json={"file_key": upload.file_key},
    )
    assert saved.status_code == 200
    assert saved.json()["personal_avatar_url"] is not None
    own_chats = await get_chats(db_session, member.id, test_redis_client)
    other_chats = await get_chats(db_session, db_user.id, test_redis_client)
    assert own_chats.chats[0].personal_avatar_url is not None
    assert other_chats.chats[0].personal_avatar_url is None
    assert other_chats.chats[0].avatar_urls == []
    reset = await api_client.delete(
        f"/api/v1/chats/{chat.id}/personal-avatar", headers=headers
    )
    assert reset.status_code == 200
    assert reset.json()["personal_avatar_url"] is None
    assert await ChatAppearanceDao.get_avatar_keys(db_session, member.id, {chat.id}) == {}


async def test_personal_avatar_rejects_foreign_keys_missing_uploads_and_nonmembers(
    db_session,
    db_userchat,
    minio_s3_storage,
):
    chat, member = db_userchat
    with pytest.raises(HTTPException) as forbidden:
        await create_personal_avatar_upload(
            db_session, uuid.uuid4(), chat.id, "image/png"
        )
    assert forbidden.value.status_code == 403
    with pytest.raises(HTTPException) as wrong_type:
        await create_personal_avatar_upload(db_session, member.id, chat.id, "text/html")
    assert wrong_type.value.status_code == 422
    with pytest.raises(HTTPException) as foreign:
        await set_personal_avatar(
            db_session,
            member.id,
            chat.id,
            f"personal_chat_avatar/{uuid.uuid4()}/{chat.id}/{uuid.uuid4().hex}.png",
        )
    assert foreign.value.status_code == 422
    upload = await create_personal_avatar_upload(
        db_session, member.id, chat.id, "image/png"
    )
    with pytest.raises(HTTPException) as missing:
        await set_personal_avatar(db_session, member.id, chat.id, upload.file_key)
    assert missing.value.status_code == 422
    storage = S3Storage()
    async with storage.session.client("s3", **storage.config) as s3:
        await s3.put_object(
            Bucket=storage.bucket_name,
            Key=upload.file_key,
            Body=b"not-image",
            ContentType="text/plain",
        )
    with pytest.raises(HTTPException) as fake:
        await set_personal_avatar(db_session, member.id, chat.id, upload.file_key)
    assert fake.value.status_code == 422
