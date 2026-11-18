from datetime import datetime, timedelta, timezone
import uuid

import pytest

from db.dao.message_dao import MessageDao
from db.models import Attachment, Message


async def test_latest_messages_for_chats_include_attachments_and_thread_replies(
    db_session, db_userchat
):
    chat, member = db_userchat
    root = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": member.id,
            "text": "first",
            "created_at": datetime(2026, 1, 1),
        },
        [],
    )
    latest = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": member.id,
            "text": None,
            "created_at": datetime(2026, 1, 2),
            "thread_root_id": root.id,
        },
        [
            {
                "chat_id": chat.id,
                "file_key": "voice.ogg",
                "file_name": "voice.ogg",
                "file_size": 3,
                "mime_type": "audio/ogg",
            }
        ],
    )
    messages = await MessageDao.get_latest_for_chats(db_session, {chat.id, uuid.uuid4()})
    assert [message.id for message in messages] == [latest.id]
    assert messages[0].attachments[0].mime_type == "audio/ogg"
    assert await MessageDao.get_latest_for_chats(db_session, set()) == []
    await MessageDao.delete_by_id(db_session, latest.id, member.id)
    assert [
        message.id
        for message in await MessageDao.get_latest_for_chats(db_session, {chat.id})
    ] == [root.id]


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


async def test_thread_queries_return_replies_and_counts(
    db_session,
    db_user,
    db_userchat,
):
    chat, member = db_userchat
    root = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "root"},
        [],
    )
    reply = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": db_user.id,
            "text": "thread reply",
            "thread_root_id": root.id,
        },
        [],
    )

    thread = await MessageDao.get_thread_messages(
        db_session,
        chat.id,
        root.id,
        member.id,
    )
    hidden_thread = await MessageDao.get_thread_messages(
        db_session,
        chat.id,
        root.id,
        uuid.uuid4(),
    )
    counts = await MessageDao.get_thread_reply_counts(db_session, {root.id})

    assert [message.id for message in thread] == [reply.id]
    assert hidden_thread == []
    assert counts == {root.id: 1}
    assert await MessageDao.get_thread_reply_counts(db_session, set()) == {}
    roots = await MessageDao.get_thread_roots(db_session, chat.id, member.id)
    assert [message.id for message in roots] == [root.id]
    assert await MessageDao.get_thread_roots(db_session, chat.id, uuid.uuid4()) == []
    assert await MessageDao.get_thread_roots(db_session, uuid.uuid4(), member.id) == []


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
    root = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "thread root"},
        [],
    )
    message_id = uuid.uuid4()
    created_at = datetime(2025, 2, 3, 4, 5, tzinfo=timezone.utc).replace(tzinfo=None)
    message = Message(
        id=message_id,
        chat_id=chat.id,
        user_id=db_user.id,
        text="retry-safe insert",
        thread_root_id=root.id,
        created_at=created_at,
    )

    await MessageDao.bulk_insert_messages(db_session, [message])
    await MessageDao.bulk_insert_messages(db_session, [message])
    loaded = await MessageDao.get_by_id(db_session, message_id)

    assert loaded.text == "retry-safe insert"
    assert loaded.thread_root_id == root.id
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


async def test_message_lookup_and_pin_methods(db_session, db_user, db_userchat):
    chat, _ = db_userchat
    original = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "original"},
        [],
    )
    reply = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": db_user.id,
            "text": "reply",
            "reply_to_id": original.id,
        },
        [],
    )

    loaded = await MessageDao.get_with_attachments(db_session, original.id)
    reply_target = await MessageDao.get_reply_target(
        db_session,
        chat.id,
        original.id,
    )
    assert loaded.id == original.id
    assert loaded.attachments == []
    assert reply_target.text == "original"
    assert (
        await MessageDao.get_reply_target(
            db_session,
            uuid.uuid4(),
            original.id,
        )
        is None
    )
    assert await MessageDao.get_message_texts(
        db_session,
        {original.id, reply.id},
    ) == {original.id: "original", reply.id: "reply"}
    assert await MessageDao.get_message_texts(db_session, set()) == {}

    assert (
        await MessageDao.toggle_pin(
            db_session,
            chat.id,
            original.id,
            db_user.id,
        )
        is True
    )
    assert await MessageDao.get_pinned_message_ids(db_session, chat.id) == {
        original.id,
    }
    assert (
        await MessageDao.toggle_pin(
            db_session,
            chat.id,
            original.id,
            db_user.id,
        )
        is False
    )
    assert await MessageDao.get_pinned_message_ids(db_session, chat.id) == set()
    assert (
        await MessageDao.toggle_pin(
            db_session,
            chat.id,
            uuid.uuid4(),
            db_user.id,
        )
        is None
    )
