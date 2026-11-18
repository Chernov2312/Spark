from datetime import datetime, timezone
import json
from typing import List
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from tasks.config_celery import celery_app

from config import RouteTags
from core.dependencies import get_redis
from core.message_actions import (
    forward_message,
    list_pinned_messages,
    list_thread_roots,
    queued_messages,
)
from core.polls import ensure_not_poll_edit
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.attachment_dao import AttachmentDao
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao
from db.database import get_session
from db.models import Attachment, Message, MessageReaction
from infrastructure.redis.client import Redis
from infrastructure.redis.message_queue import (
    history_cache_key,
    HISTORY_CACHE_TTL_SECONDS,
    message_queue_key,
)
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import (
    AttachmentRequest,
    AttachmentResponse,
    MessageForwardRequest,
    MessageHistory,
    MessageInternalDTO,
    MessageRequest,
    MessageResponse,
)
from schemas.responses import (
    AudioTranscriptionResponse,
    MessageDeletedResponse,
    MessagePinnedResponse,
)

message_router = APIRouter(prefix="/api/v1", tags=[RouteTags.MESSAGES])


@message_router.get("/chats/{chat_id}/threads")
async def get_chat_threads(
    chat_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> MessageHistory:
    roots = await list_thread_roots(session, redis, chat_id, user_id)
    counts = await MessageDao.get_thread_reply_counts(
        session, {root.id for root in roots}
    )
    pending = await queued_messages(redis, chat_id)
    pinned_ids = await MessageDao.get_pinned_message_ids(session, chat_id)
    persisted = await MessageDao.get_message_texts(session, {item.id for item in pending})
    for item in pending:
        if item.thread_root_id is not None and item.id not in persisted:
            counts[item.thread_root_id] = counts.get(item.thread_root_id, 0) + 1
    return MessageHistory(
        messages=[
            await _build_message_response(
                message_id=root.id,
                poll_id=root.poll_id if isinstance(root, Message) else None,
                chat_id=root.chat_id,
                user_id=root.user_id,
                text=root.text,
                created_at=root.created_at,
                attachments=root.attachments,
                thread_reply_count=counts.get(root.id, 0),
                is_pinned=root.id in pinned_ids,
            )
            for root in roots
        ]
    )


@message_router.post("/chats/{chat_id}/messages/{message_id}/forward", status_code=201)
async def forward_chat_message(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    data: MessageForwardRequest,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> MessageResponse:
    message = await forward_message(
        session, redis, chat_id, message_id, data.target_chat_id, user_id
    )
    response = await _build_message_response(
        message_id=message.id,
        chat_id=message.chat_id,
        user_id=message.user_id,
        text=message.text,
        created_at=message.created_at,
        attachments=message.attachments,
    )
    await RedisDao.invalidate_history(redis, message.chat_id)
    await RedisDao.publish_chat_event(
        redis,
        message.chat_id,
        json.dumps({"event": "message:new", "data": response.model_dump(mode="json")}),
    )
    return response


def _message_sort_key(message: MessageResponse) -> float:
    created_at = message.created_at
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.timestamp()


def _is_before_cursor(created_at: datetime, before: datetime) -> bool:
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    if before.tzinfo is None:
        before = before.replace(tzinfo=timezone.utc)
    return created_at < before


async def _build_message_response(
    *,
    message_id: uuid.UUID,
    chat_id: uuid.UUID,
    user_id: uuid.UUID,
    text: str | None,
    created_at: datetime,
    attachments: list[Attachment | AttachmentRequest],
    reactions_count: dict[str, int] | None = None,
    user_reaction: str | None = None,
    reply_to_id: uuid.UUID | None = None,
    reply_to_text: str | None = None,
    thread_root_id: uuid.UUID | None = None,
    thread_reply_count: int = 0,
    edited_at: datetime | None = None,
    is_pinned: bool = False,
    poll_id: uuid.UUID | None = None,
) -> MessageResponse:
    s3 = S3Storage()
    signed_attachments = []
    for attachment in attachments:
        file_key = attachment.file_key
        url = await s3.get_temporary_url(file_key)
        signed_attachments.append(
            AttachmentResponse(
                id=attachment.id,
                chat_id=chat_id,
                user_id=user_id,
                file_key=url,
                file_name=attachment.file_name,
                file_size=attachment.file_size,
                mime_type=attachment.mime_type,
                text=attachment.text,
            ),
        )
    return MessageResponse(
        id=message_id,
        chat_id=chat_id,
        user_id=user_id,
        text=text,
        reply_to_id=reply_to_id,
        reply_to_text=reply_to_text,
        thread_root_id=thread_root_id,
        thread_reply_count=thread_reply_count,
        edited_at=edited_at,
        is_pinned=is_pinned,
        poll_id=poll_id,
        user_reaction=user_reaction,
        attachments=signed_attachments,
        reactions_count=reactions_count or {},
        created_at=created_at,
    )


@message_router.get("/chats/{chat_id}/messages", status_code=status.HTTP_200_OK)
async def get_messages_history(
    chat_id: uuid.UUID,
    limit: int = 50,
    before: datetime | None = None,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> MessageHistory:
    version = await RedisDao.get_history_version(redis, chat_id)
    cache_key = history_cache_key(chat_id, user_id, limit, before, version)
    cached_history = await RedisDao.get_value(redis, cache_key)
    if cached_history:
        try:
            return MessageHistory.model_validate_json(cached_history)
        except ValueError:
            await RedisDao.delete_key(redis, cache_key)

    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this chat",
        )

    db_messages: List[Message] = await MessageDao.get_chat_history(
        session=session,
        chat_id=chat_id,
        user_id=user_id,
        limit=limit,
        before=before,
    )
    messages_id = [message.id for message in db_messages]
    user_reactions: List[MessageReaction] = await MessageReactionDao.get_user_reactions(
        session=session,
        user_id=user_id,
        loaded_message_ids=messages_id,
    )
    reaction_by_message_id = {
        reaction.message_id: reaction.emoji for reaction in user_reactions
    }
    pinned_ids = await MessageDao.get_pinned_message_ids(session, chat_id)
    reply_ids = {message.reply_to_id for message in db_messages if message.reply_to_id}
    reply_texts = await MessageDao.get_message_texts(session, reply_ids)
    thread_counts = await MessageDao.get_thread_reply_counts(
        session,
        {message.id for message in db_messages},
    )
    pending_entries = await RedisDao.get_stream_entries(
        redis,
        message_queue_key(chat_id),
    )
    for _, fields in pending_entries:
        queued = MessageInternalDTO.model_validate_json(fields["payload"])
        if queued.thread_root_id in thread_counts:
            thread_counts[queued.thread_root_id] += 1
        elif queued.thread_root_id in {message.id for message in db_messages}:
            thread_counts[queued.thread_root_id] = 1

    merged: dict[uuid.UUID, MessageResponse] = {}
    for message in db_messages:
        merged[message.id] = await _build_message_response(
            message_id=message.id,
            poll_id=message.poll_id,
            chat_id=message.chat_id,
            user_id=message.user_id,
            text=message.text,
            created_at=message.created_at,
            attachments=message.attachments,
            reactions_count=message.reactions_count,
            user_reaction=reaction_by_message_id.get(message.id),
            reply_to_id=message.reply_to_id,
            reply_to_text=reply_texts.get(message.reply_to_id),
            thread_root_id=message.thread_root_id,
            thread_reply_count=thread_counts.get(message.id, 0),
            edited_at=message.edited_at,
            is_pinned=message.id in pinned_ids,
        )

    for _, fields in pending_entries:
        queued_message = MessageInternalDTO.model_validate_json(fields["payload"])
        if queued_message.thread_root_id is not None:
            continue
        if before is not None and not _is_before_cursor(
            queued_message.created_at,
            before,
        ):
            continue
        if queued_message.id in merged:
            continue
        merged[queued_message.id] = await _build_message_response(
            message_id=queued_message.id,
            chat_id=queued_message.chat_id,
            user_id=user_id,
            text=queued_message.text,
            created_at=queued_message.created_at,
            attachments=queued_message.attachments,
        )

    sorted_messages = sorted(
        merged.values(),
        key=_message_sort_key,
        reverse=True,
    )[:limit]
    history = MessageHistory(messages=sorted_messages)
    await RedisDao.cache_history_if_current(
        redis,
        chat_id=chat_id,
        expected_version=version,
        key=cache_key,
        value=history.model_dump_json(),
        expiration_seconds=HISTORY_CACHE_TTL_SECONDS,
    )
    return history


@message_router.get(
    "/chats/{chat_id}/messages/{root_message_id}/thread",
    status_code=status.HTTP_200_OK,
)
async def get_message_thread(
    chat_id: uuid.UUID,
    root_message_id: uuid.UUID,
    limit: int = 100,
    before: datetime | None = None,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
    redis: Redis = Depends(get_redis),
) -> MessageHistory:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=403, detail="You are not a member of this chat")
    root = await MessageDao.get_with_attachments(session, root_message_id)
    queued_root = None
    if root is None:
        for _, fields in await RedisDao.get_stream_entries(
            redis,
            message_queue_key(chat_id),
        ):
            candidate = MessageInternalDTO.model_validate_json(fields["payload"])
            if candidate.id == root_message_id:
                queued_root = candidate
                break
    if (
        (root is None and queued_root is None)
        or (root is not None and root.chat_id != chat_id)
        or (root is not None and root.thread_root_id is not None)
        or (queued_root is not None and queued_root.thread_root_id is not None)
    ):
        raise HTTPException(status_code=404, detail="Thread root not found")

    replies = await MessageDao.get_thread_messages(
        session,
        chat_id,
        root_message_id,
        user_id,
        limit,
        before,
    )
    # Include queued replies so a newly sent thread message is immediately visible.
    queued_replies: list[MessageInternalDTO] = []
    for _, fields in await RedisDao.get_stream_entries(redis, message_queue_key(chat_id)):
        queued = MessageInternalDTO.model_validate_json(fields["payload"])
        if queued.thread_root_id == root_message_id and (
            before is None or _is_before_cursor(queued.created_at, before)
        ):
            queued_replies.append(queued)

    pinned_ids = await MessageDao.get_pinned_message_ids(session, chat_id)
    items: list[MessageResponse] = []
    if before is None:
        root_thread_counts = await MessageDao.get_thread_reply_counts(
            session, {root_message_id}
        )
        items.append(
            await _build_message_response(
                message_id=root.id if root is not None else queued_root.id,
                poll_id=root.poll_id if root is not None else None,
                chat_id=chat_id,
                user_id=root.user_id if root is not None else queued_root.user_id,
                text=root.text if root is not None else queued_root.text,
                created_at=root.created_at
                if root is not None
                else queued_root.created_at,
                attachments=root.attachments
                if root is not None
                else queued_root.attachments,
                is_pinned=root_message_id in pinned_ids,
                thread_reply_count=(
                    root_thread_counts.get(root_message_id, 0)
                    + sum(
                        item.thread_root_id == root_message_id
                        and all(reply.id != item.id for reply in replies)
                        for item in queued_replies
                    )
                ),
            )
        )
    for reply in replies:
        items.append(
            await _build_message_response(
                message_id=reply.id,
                poll_id=reply.poll_id,
                chat_id=reply.chat_id,
                user_id=reply.user_id,
                text=reply.text,
                created_at=reply.created_at,
                attachments=reply.attachments,
                reply_to_id=reply.reply_to_id,
                thread_root_id=reply.thread_root_id,
                is_pinned=reply.id in pinned_ids,
            )
        )
    for queued in queued_replies:
        if all(item.id != queued.id for item in items):
            items.append(
                await _build_message_response(
                    message_id=queued.id,
                    chat_id=queued.chat_id,
                    user_id=queued.user_id,
                    text=queued.text,
                    created_at=queued.created_at,
                    attachments=queued.attachments,
                    reply_to_id=queued.reply_to_id,
                    thread_root_id=queued.thread_root_id,
                )
            )
    return MessageHistory(messages=sorted(items, key=_message_sort_key))


@message_router.post("/chats/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: uuid.UUID,
    message: MessageRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> MessageResponse:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this chat",
        )

    requested_file_keys = [attachment.file_key for attachment in message.attachments]
    if len(set(requested_file_keys)) != len(requested_file_keys):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Duplicate message attachments are not allowed",
        )
    stored_attachments = await AttachmentDao.get_pending_message_attachments(
        session=session,
        chat_id=chat_id,
        file_keys=requested_file_keys,
    )
    stored_by_file_key = {
        attachment.file_key: attachment for attachment in stored_attachments
    }
    queued_attachments = []
    for requested_attachment in message.attachments:
        stored_attachment = stored_by_file_key.get(requested_attachment.file_key)
        if (
            stored_attachment is None
            or requested_attachment.chat_id != chat_id
            or requested_attachment.is_avatar
            or (
                requested_attachment.id is not None
                and requested_attachment.id != stored_attachment.id
            )
            or requested_attachment.file_name != stored_attachment.file_name
            or requested_attachment.file_size != stored_attachment.file_size
            or requested_attachment.mime_type != stored_attachment.mime_type
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="One or more attachments are invalid for this chat",
            )
        queued_attachments.append(
            requested_attachment.model_copy(update={"id": stored_attachment.id}),
        )

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    reply_to_text = None
    if message.thread_root_id:
        thread_root = await MessageDao.get_reply_target(
            session,
            chat_id,
            message.thread_root_id,
        )
        if thread_root is None:
            for _, fields in await RedisDao.get_stream_entries(
                redis,
                message_queue_key(chat_id),
            ):
                candidate = MessageInternalDTO.model_validate_json(fields["payload"])
                if candidate.id == message.thread_root_id:
                    thread_root = candidate
                    break
        if (
            thread_root is None
            or thread_root.thread_root_id is not None
            or thread_root.chat_id != chat_id
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Thread root must be a top-level message in this chat",
            )
    if message.reply_to_id:
        replied_message = await MessageDao.get_reply_target(
            session,
            chat_id,
            message.reply_to_id,
        )
        if replied_message is None:
            for _, fields in await RedisDao.get_stream_entries(
                redis, message_queue_key(chat_id)
            ):
                candidate = MessageInternalDTO.model_validate_json(fields["payload"])
                if candidate.id == message.reply_to_id and candidate.chat_id == chat_id:
                    replied_message = candidate
                    break
        if replied_message is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Reply target must belong to this chat",
            )
        reply_to_text = replied_message.text
    queued_message = MessageInternalDTO(
        id=uuid.uuid4(),
        chat_id=chat_id,
        user_id=user_id,
        text=message.text,
        reply_to_id=message.reply_to_id,
        thread_root_id=message.thread_root_id,
        attachments=queued_attachments,
        created_at=now,
    )
    valid = await _build_message_response(
        message_id=queued_message.id,
        chat_id=chat_id,
        user_id=user_id,
        text=queued_message.text,
        created_at=queued_message.created_at,
        attachments=queued_attachments,
        reply_to_id=queued_message.reply_to_id,
        reply_to_text=reply_to_text,
        thread_root_id=queued_message.thread_root_id,
    )
    await RedisDao.enqueue_message(redis, queued_message)
    await RedisDao.publish_chat_event(
        redis,
        chat_id,
        json.dumps({"event": "message:new", "data": valid.model_dump(mode="json")}),
    )
    return valid


@message_router.get("/chats/{chat_id}/messages/search")
async def search_messages(
    chat_id: uuid.UUID,
    text: str | None = None,
    author_id: uuid.UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    attachment_type: str | None = Query(default=None),
    limit: int = 100,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> MessageHistory:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=403, detail="You are not a member of this chat")
    rows = await MessageDao.search_chat_history(
        session,
        chat_id,
        user_id,
        query_text=text,
        author_id=author_id,
        since=since,
        until=until,
        attachment_type=attachment_type,
        limit=limit,
    )
    pinned_ids = await MessageDao.get_pinned_message_ids(session, chat_id)
    return MessageHistory(
        messages=[
            await _build_message_response(
                message_id=row.id,
                poll_id=row.poll_id,
                chat_id=row.chat_id,
                user_id=row.user_id,
                text=row.text,
                created_at=row.created_at,
                attachments=row.attachments,
                reply_to_id=row.reply_to_id,
                thread_root_id=row.thread_root_id,
                edited_at=row.edited_at,
                is_pinned=row.id in pinned_ids,
            )
            for row in rows
        ]
    )


@message_router.get("/chats/{chat_id}/messages/pinned")
async def get_pinned_messages(
    chat_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> MessageHistory:
    rows = await list_pinned_messages(session, chat_id, user_id)
    counts = await MessageDao.get_thread_reply_counts(session, {row.id for row in rows})
    reply_texts = await MessageDao.get_message_texts(
        session, {row.reply_to_id for row in rows if row.reply_to_id}
    )
    return MessageHistory(
        messages=[
            await _build_message_response(
                message_id=row.id,
                poll_id=row.poll_id,
                chat_id=row.chat_id,
                user_id=row.user_id,
                text=row.text,
                created_at=row.created_at,
                attachments=row.attachments,
                reply_to_id=row.reply_to_id,
                reply_to_text=reply_texts.get(row.reply_to_id),
                thread_root_id=row.thread_root_id,
                thread_reply_count=counts.get(row.id, 0),
                reactions_count=row.reactions_count,
                edited_at=row.edited_at,
                is_pinned=True,
            )
            for row in rows
        ]
    )


@message_router.put("/chats/{chat_id}/messages/{message_id}/pin")
async def toggle_message_pin(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> MessagePinnedResponse:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None or not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=404, detail="Chat not found")
    pinned = await MessageDao.toggle_pin(
        session,
        chat_id,
        message_id,
        user_id,
    )
    if pinned is None:
        raise HTTPException(status_code=404, detail="Message not found")
    message = await MessageDao.get_with_attachments(session, message_id)
    if message is None:
        raise HTTPException(status_code=404, detail="Message not found")
    counts = await MessageDao.get_thread_reply_counts(session, {message.id})
    reply_texts = await MessageDao.get_message_texts(
        session, {message.reply_to_id} if message.reply_to_id else set()
    )
    response = await _build_message_response(
        message_id=message.id,
        poll_id=message.poll_id,
        chat_id=message.chat_id,
        user_id=message.user_id,
        text=message.text,
        created_at=message.created_at,
        attachments=message.attachments,
        reply_to_id=message.reply_to_id,
        reply_to_text=reply_texts.get(message.reply_to_id),
        thread_root_id=message.thread_root_id,
        thread_reply_count=counts.get(message.id, 0),
        reactions_count=message.reactions_count,
        edited_at=message.edited_at,
        is_pinned=pinned,
    )
    await RedisDao.invalidate_history(redis, chat_id)
    await RedisDao.publish_chat_event(
        redis,
        chat_id,
        json.dumps(
            {
                "event": "message:updated",
                "data": response.model_dump(mode="json"),
            }
        ),
    )
    return MessagePinnedResponse(pinned=pinned)


@message_router.post(
    "/chats/{chat_id}/messages/{message_id}/attachments/{attachment_id}/transcribe",
    status_code=status.HTTP_202_ACCEPTED,
)
async def transcribe_audio_attachment(
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    attachment_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> AudioTranscriptionResponse:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a member of this chat",
        )

    attachment = await AttachmentDao.get_by_id(session, attachment_id)
    if (
        attachment is None
        or attachment.chat_id != chat_id
        or attachment.is_avatar
        or attachment.msg_id not in (None, message_id)
    ):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Audio attachment not found",
        )
    is_audio = attachment.mime_type.startswith("audio/") or (
        attachment.file_name.lower().endswith(
            (
                ".wav",
                ".mp3",
                ".ogg",
                ".opus",
                ".m4a",
                ".aac",
                ".flac",
                ".webm",
            ),
        )
    )
    if not is_audio:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Attachment is not an audio file",
        )
    if attachment.text is not None:
        return AudioTranscriptionResponse(queued=False)

    celery_app.send_task(
        "tasks.audio_convert.convert_audio_task",
        args=[
            str(user_id),
            str(chat_id),
            str(message_id),
            str(attachment.id),
            attachment.file_key,
        ],
    )
    return AudioTranscriptionResponse(queued=True)


@message_router.put("/messages/{message_id}")
async def update_message(
    message_id: uuid.UUID,
    message: MessageRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> MessageResponse:
    await ensure_not_poll_edit(session, message_id, user_id)
    res = await MessageDao.update_by_id(
        session=session,
        target_id=message_id,
        user_id=user_id,
        text=message.text,
    )
    if res is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found or you don't have permission to edit it",
        )
    updated = await MessageDao.get_with_attachments(session, res.id)
    if updated is None:
        raise HTTPException(status_code=404, detail="Message not found")
    pinned_ids = await MessageDao.get_pinned_message_ids(session, updated.chat_id)
    response = await _build_message_response(
        message_id=updated.id,
        poll_id=updated.poll_id,
        chat_id=updated.chat_id,
        user_id=updated.user_id,
        text=updated.text,
        created_at=updated.created_at,
        attachments=updated.attachments,
        reactions_count=updated.reactions_count,
        reply_to_id=updated.reply_to_id,
        thread_root_id=updated.thread_root_id,
        edited_at=updated.edited_at,
        is_pinned=updated.id in pinned_ids,
    )
    await RedisDao.invalidate_history(redis, res.chat_id)
    await RedisDao.publish_chat_event(
        redis,
        res.chat_id,
        json.dumps(
            {"event": "message:updated", "data": response.model_dump(mode="json")}
        ),
    )
    return response


@message_router.delete("/messages/{message_id}")
async def delete_message(
    message_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> MessageDeletedResponse:
    message_chat_id = await MessageDao.get_chat_id_by_message(session, message_id)
    res = await MessageDao.delete_by_id(
        session=session,
        target_id=message_id,
        user_id=user_id,
    )
    if not res:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found or you don't have permission to edit it",
        )
    if message_chat_id is not None:
        await RedisDao.invalidate_history(redis, message_chat_id)
        await RedisDao.publish_chat_event(
            redis,
            message_chat_id,
            json.dumps(
                {
                    "event": "message:deleted",
                    "data": {
                        "chat_id": str(message_chat_id),
                        "message_id": str(message_id),
                    },
                }
            ),
        )
    return MessageDeletedResponse(deleted=True)
