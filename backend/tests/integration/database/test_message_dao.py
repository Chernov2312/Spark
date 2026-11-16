from datetime import datetime, timedelta, timezone
import uuid

import pytest

from db.dao.message_dao import MessageDao
from db.models import Attachment, Message


async def test_get_chat_history_orders_pages_and_checks_membership(
    db_session,
    db_user,
    db_userchat,
):
    chat, member = db_userchat
    base_time = datetime(2025, 1, 1, tzinfo=timezone.utc).replace(tzinfo=None)
    messages = []
    for offset in range(3):
        message = await MessageDao.create_with_attachments(
            db_session,
            {
                "chat_id": chat.id,
                "user_id": db_user.id,
                "text": f"message {offset}",
                "created_at": base_time + timedelta(minutes=offset),
            },
            [],
        )
        messages.append(message)

    page = await MessageDao.get_chat_history(
        db_session,
        chat.id,
        member.id,
        limit=2,
    )
    older_page = await MessageDao.get_chat_history(
        db_session,
        chat.id,
        member.id,
        before=base_time + timedelta(minutes=2),
    )
    hidden_history = await MessageDao.get_chat_history(
        db_session,
        chat.id,
        uuid.uuid4(),
    )

    assert [message.id for message in page] == [messages[2].id, messages[1].id]
    assert [message.id for message in older_page] == [messages[1].id, messages[0].id]
    assert hidden_history == []


async def test_message_update_delete_are_limited_to_author(
    db_session,
    db_user,
    db_userchat,
):
    chat, another_user = db_userchat
    message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "original"},
        [],
    )

    assert (
        await MessageDao.update_by_id(
            db_session,
            message.id,
            another_user.id,
            "unauthorized edit",
        )
        is None
    )
    updated = await MessageDao.update_by_id(
        db_session,
        message.id,
        db_user.id,
        "updated",
    )
    assert updated.text == "updated"
    assert await MessageDao.get_chat_id_by_message(db_session, message.id) == chat.id
    assert await MessageDao.delete_by_id(db_session, message.id, another_user.id) is False
    assert await MessageDao.delete_by_id(db_session, message.id, db_user.id) is True
    assert await MessageDao.get_chat_id_by_message(db_session, message.id) is None


async def test_bulk_insert_messages_preserves_timestamp_and_ignores_duplicate(
    db_session,
    db_user,
    db_userchat,
):
    chat, _ = db_userchat
    message_id = uuid.uuid4()
    created_at = datetime(2025, 2, 3, 4, 5, tzinfo=timezone.utc).replace(tzinfo=None)
    message = Message(
        id=message_id,
        chat_id=chat.id,
        user_id=db_user.id,
        text="retry-safe insert",
        created_at=created_at,
    )

    await MessageDao.bulk_insert_messages(db_session, [message])
    await MessageDao.bulk_insert_messages(db_session, [message])
    loaded = await MessageDao.get_by_id(db_session, message_id)

    assert loaded.text == "retry-safe insert"
    assert loaded.created_at == created_at
    assert await MessageDao.bulk_insert_messages(db_session, []) is None


async def test_create_with_attachments_persists_relationship(
    db_session,
    db_user,
    db_userchat,
):
    chat, member = db_userchat
    message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "file"},
        [
            {
                "chat_id": chat.id,
                "file_key": "upload/file.txt",
                "file_name": "file.txt",
                "file_size": 4,
                "mime_type": "text/plain",
            },
        ],
    )
    loaded = await MessageDao.get_chat_history(db_session, chat.id, member.id)

    assert len(loaded) == 1
    assert loaded[0].id == message.id
    assert loaded[0].attachments[0].file_key == "upload/file.txt"


async def test_attach_queued_attachments_rejects_missing_attachment(
    db_session,
    db_user,
    db_userchat,
):
    chat, _ = db_userchat
    queued_message = Message(
        id=uuid.uuid4(),
        chat_id=chat.id,
        user_id=db_user.id,
        text="queued",
    )
    queued_message.attachments = [
        # This ID was never inserted in the attachment table.
        Attachment(
            id=uuid.uuid4(),
            chat_id=chat.id,
            file_key="missing.txt",
            file_name="missing.txt",
            file_size=1,
            mime_type="text/plain",
        ),
    ]

    with pytest.raises(ValueError, match="no longer exists or is in use"):
        await MessageDao.attach_queued_attachments(db_session, [queued_message])
