from datetime import datetime
import uuid

from fastapi import HTTPException
import pytest

from api.v1.message import forward_chat_message, get_chat_threads, get_messages_history
from core.message_actions import (
    forward_message,
    get_chat_message_previews,
    list_thread_roots,
)
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import AttachmentRequest, MessageForwardRequest, MessageInternalDTO
from schemas.websockets import WsEvent


async def test_forward_copies_attachments_and_checks_both_memberships(
    db_session,
    db_userchat,
    test_redis_client,
):
    chat, member = db_userchat
    source = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": member.id, "text": "original"},
        [
            {
                "chat_id": chat.id,
                "file_key": "file.txt",
                "file_name": "file.txt",
                "file_size": 4,
                "mime_type": "text/plain",
            }
        ],
    )
    target = await ChatDao.add(
        db_session,
        {
            "owner_id": member.id,
            "title": "Forward target",
            "description": "",
        },
    )
    await ChatDao.add_users_to_chat(db_session, target.id, [member.id])
    copy = await forward_message(
        db_session,
        test_redis_client,
        chat.id,
        source.id,
        target.id,
        member.id,
    )
    assert copy.id != source.id
    assert copy.chat_id == target.id
    assert copy.text == source.text
    assert copy.is_forwarded
    assert not source.is_forwarded
    assert copy.attachments[0].id != source.attachments[0].id
    assert copy.attachments[0].chat_id == target.id
    assert copy.attachments[0].file_key == source.attachments[0].file_key
    with pytest.raises(HTTPException) as denied:
        await forward_message(
            db_session,
            test_redis_client,
            chat.id,
            source.id,
            target.id,
            uuid.uuid4(),
        )
    assert denied.value.status_code == 403
    other = await ChatDao.add(
        db_session,
        {
            "owner_id": member.id,
            "title": "Private target",
            "description": "",
        },
    )
    with pytest.raises(HTTPException) as target_denied:
        await forward_message(
            db_session,
            test_redis_client,
            chat.id,
            source.id,
            other.id,
            member.id,
        )
    assert target_denied.value.status_code == 403


async def test_queued_thread_discovery_and_forwarding(
    db_session,
    db_userchat,
    test_redis_client,
):
    chat, member = db_userchat
    root = MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=chat.id,
        user_id=member.id,
        text="queued root",
        attachments=[
            AttachmentRequest(
                chat_id=chat.id,
                file_key="queued.txt",
                file_name="queued.txt",
                file_size=2,
                mime_type="text/plain",
            )
        ],
    )
    reply = MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=chat.id,
        user_id=member.id,
        text="reply",
        thread_root_id=root.id,
    )
    await RedisDao.enqueue_message(test_redis_client, root)
    await RedisDao.enqueue_message(test_redis_client, reply)
    roots = await list_thread_roots(db_session, test_redis_client, chat.id, member.id)
    assert [item.id for item in roots] == [root.id]
    copy = await forward_message(
        db_session,
        test_redis_client,
        chat.id,
        root.id,
        chat.id,
        member.id,
    )
    assert copy.text == root.text
    assert copy.is_forwarded
    assert copy.attachments[0].file_key == "queued.txt"


async def test_thread_list_and_forward_route_responses(
    db_session, db_userchat, test_redis_client
):
    chat, member = db_userchat
    root = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": member.id, "text": "root"},
        [],
    )
    queued_reply = MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=chat.id,
        user_id=member.id,
        text="pending reply",
        thread_root_id=root.id,
    )
    await RedisDao.enqueue_message(test_redis_client, queued_reply)
    threads = await get_chat_threads(chat.id, member.id, db_session, test_redis_client)
    assert [item.id for item in threads.messages] == [root.id]
    assert threads.messages[0].thread_reply_count == 1
    async with test_redis_client.pubsub() as subscriber:
        await subscriber.subscribe(f"chat:{chat.id}")
        await subscriber.get_message(timeout=1)
        forwarded = await forward_chat_message(
            chat.id,
            root.id,
            MessageForwardRequest(target_chat_id=chat.id),
            member.id,
            db_session,
            test_redis_client,
        )
        event = await subscriber.get_message(ignore_subscribe_messages=True, timeout=2)
        published = WsEvent.model_validate_json(event["data"])
        assert published.data.id == forwarded.id
        assert published.data.is_forwarded
    assert forwarded.id != root.id
    assert forwarded.text == root.text
    assert forwarded.user_id == member.id
    assert forwarded.is_forwarded
    history = await get_messages_history(
        chat.id, user_id=member.id, session=db_session, redis=test_redis_client
    )
    markers = {message.id: message.is_forwarded for message in history.messages}
    assert markers == {root.id: False, forwarded.id: True}


async def test_last_message_preview_merges_queue_and_database(
    db_session, db_userchat, test_redis_client
):
    chat, member = db_userchat
    root = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": member.id,
            "text": "saved",
            "created_at": datetime(2026, 1, 1),
        },
        [],
    )
    pending = MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=chat.id,
        user_id=member.id,
        text=None,
        created_at=datetime(2026, 1, 2),
        thread_root_id=root.id,
        attachments=[
            AttachmentRequest(
                chat_id=chat.id,
                file_key="private-object-key",
                file_name="voice.ogg",
                file_size=3,
                mime_type="audio/ogg",
            )
        ],
    )
    await RedisDao.enqueue_message(test_redis_client, pending)
    previews = await get_chat_message_previews(db_session, test_redis_client, {chat.id})
    assert previews[chat.id].id == pending.id
    assert previews[chat.id].attachments[0].mime_type == "audio/ogg"
    assert "private-object-key" not in previews[chat.id].model_dump_json()
    assert (
        await get_chat_message_previews(db_session, test_redis_client, {uuid.uuid4()})
        == {}
    )
    assert await get_chat_message_previews(db_session, test_redis_client, set()) == {}
    newer = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": member.id,
            "text": "newer saved",
            "created_at": datetime(2026, 1, 3),
        },
        [],
    )
    previews = await get_chat_message_previews(db_session, test_redis_client, {chat.id})
    assert previews[chat.id].id == newer.id
