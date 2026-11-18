"""Thread discovery and forwarding, including messages awaiting persistence."""

from datetime import timezone
import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.models import Message
from infrastructure.redis.client import Redis
from infrastructure.redis.message_queue import message_queue_key
from infrastructure.redis.redis_dao import RedisDao
from schemas.chats import ChatMessagePreview
from schemas.message import MessageInternalDTO


async def get_chat_message_previews(
    session: AsyncSession,
    redis: Redis,
    chat_ids: set[uuid.UUID],
) -> dict[uuid.UUID, ChatMessagePreview]:
    # Read pending messages first: a worker may commit and remove them during the DB query.
    pending: list[MessageInternalDTO] = []
    for chat_id in chat_ids:
        pending.extend(await queued_messages(redis, chat_id))
    persisted = await MessageDao.get_latest_for_chats(session, chat_ids)
    previews: dict[uuid.UUID, ChatMessagePreview] = {}
    for message in [*persisted, *pending]:
        if message.chat_id not in chat_ids:
            continue
        preview = ChatMessagePreview.model_validate(message)
        previous = previews.get(message.chat_id)
        created_at = preview.created_at.replace(
            tzinfo=preview.created_at.tzinfo or timezone.utc
        )
        previous_time = (
            previous.created_at.replace(tzinfo=previous.created_at.tzinfo or timezone.utc)
            if previous
            else None
        )
        if previous is None or (created_at, preview.id) > (previous_time, previous.id):
            previews[message.chat_id] = preview
    return previews


async def ensure_chat_member(
    session: AsyncSession,
    chat_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    chat = await ChatDao.get_chat_with_users(session, chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=403, detail="You are not a member of this chat")


async def queued_messages(redis: Redis, chat_id: uuid.UUID) -> list[MessageInternalDTO]:
    return [
        MessageInternalDTO.model_validate_json(fields["payload"])
        for _, fields in await RedisDao.get_stream_entries(
            redis, message_queue_key(chat_id)
        )
    ]


async def list_pinned_messages(
    session: AsyncSession,
    chat_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[Message]:
    await ensure_chat_member(session, chat_id, user_id)
    return await MessageDao.get_pinned_messages(session, chat_id)


async def list_thread_roots(
    session: AsyncSession,
    redis: Redis,
    chat_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[Message | MessageInternalDTO]:
    await ensure_chat_member(session, chat_id, user_id)
    roots: dict[uuid.UUID, Message | MessageInternalDTO] = {
        root.id: root
        for root in await MessageDao.get_thread_roots(session, chat_id, user_id)
    }
    pending = await queued_messages(redis, chat_id)
    pending_by_id = {item.id: item for item in pending}
    for item in pending:
        if item.thread_root_id is None or item.thread_root_id in roots:
            continue
        root: Message | MessageInternalDTO | None = await MessageDao.get_with_attachments(
            session,
            item.thread_root_id,
        )
        root = root or pending_by_id.get(item.thread_root_id)
        if root is not None and root.chat_id == chat_id and root.thread_root_id is None:
            roots[root.id] = root
    return list(roots.values())


async def forward_message(
    session: AsyncSession,
    redis: Redis,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    target_chat_id: uuid.UUID,
    user_id: uuid.UUID,
) -> Message:
    await ensure_chat_member(session, chat_id, user_id)
    await ensure_chat_member(session, target_chat_id, user_id)
    source: Message | MessageInternalDTO | None = await MessageDao.get_with_attachments(
        session, message_id
    )
    if source is None:
        source = next(
            (
                item
                for item in await queued_messages(redis, chat_id)
                if item.id == message_id
            ),
            None,
        )
    if source is None or source.chat_id != chat_id:
        raise HTTPException(status_code=404, detail="Message not found")
    if isinstance(source, Message) and source.poll_id is not None:
        raise HTTPException(status_code=422, detail="Polls cannot be forwarded")
    return await MessageDao.create_with_attachments(
        session,
        {"chat_id": target_chat_id, "user_id": user_id, "text": source.text},
        [
            {
                "chat_id": target_chat_id,
                "file_key": attachment.file_key,
                "file_name": attachment.file_name,
                "file_size": attachment.file_size,
                "mime_type": attachment.mime_type,
                "text": attachment.text,
            }
            for attachment in source.attachments
        ],
    )
