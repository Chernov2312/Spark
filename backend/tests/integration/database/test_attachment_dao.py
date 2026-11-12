import uuid

from db.dao.attachment_dao import AttachmentDao
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao


async def test_get_pending_message_attachments_filters_chat_and_claimed_files(
    db_session,
    db_user,
    db_userchat,
):
    chat, _ = db_userchat
    other_chat = await ChatDao.add(
        db_session,
        {
            "owner_id": db_user.id,
            "title": "another-attachment-chat",
            "description": "test",
        },
    )
    claimed_message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "claimed"},
        [],
    )
    pending_key = f"user_message/{db_user.id}/pending.txt"
    other_chat_key = f"user_message/{db_user.id}/other.txt"
    claimed_key = f"user_message/{db_user.id}/claimed.txt"
    pending = await AttachmentDao.add(
        db_session,
        {
            "chat_id": chat.id,
            "file_key": pending_key,
            "file_name": "pending.txt",
            "file_size": 10,
            "mime_type": "text/plain",
        },
    )
    await AttachmentDao.add(
        db_session,
        {
            "chat_id": other_chat.id,
            "file_key": other_chat_key,
            "file_name": "other.txt",
            "file_size": 10,
            "mime_type": "text/plain",
        },
    )
    await AttachmentDao.add(
        db_session,
        {
            "chat_id": chat.id,
            "file_key": claimed_key,
            "msg_id": claimed_message.id,
            "file_name": "claimed.txt",
            "file_size": 10,
            "mime_type": "text/plain",
        },
    )
    avatar = await AttachmentDao.add(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": db_user.id,
            "file_key": "avatar.png",
            "file_name": "avatar.png",
            "file_size": 10,
            "mime_type": "image/png",
            "is_avatar": True,
        },
    )

    result = await AttachmentDao.get_pending_message_attachments(
        db_session,
        chat.id,
        [pending_key, other_chat_key, claimed_key, avatar.file_key],
    )

    assert [attachment.id for attachment in result] == [pending.id]
    assert (
        await AttachmentDao.get_pending_message_attachments(
            db_session,
            chat.id,
            [],
        )
        == []
    )


async def test_delete_attachment_requires_matching_user(db_session, db_user):
    file_key = f"user_message/{db_user.id}/delete-me.txt"
    attachment = await AttachmentDao.add(
        db_session,
        {
            "user_id": db_user.id,
            "file_key": file_key,
            "file_name": "delete-me.txt",
            "file_size": 10,
            "mime_type": "text/plain",
        },
    )

    assert (
        await AttachmentDao.delete_attachment_by_url_and_user_id(
            db_session,
            file_key,
            uuid.uuid4(),
        )
        is False
    )
    assert await AttachmentDao.get_by_id(db_session, attachment.id) is not None
    assert (
        await AttachmentDao.delete_attachment_by_url_and_user_id(
            db_session,
            file_key,
            db_user.id,
        )
        is True
    )
    assert await AttachmentDao.get_by_id(db_session, attachment.id) is None
