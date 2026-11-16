from datetime import datetime, timezone
import json
from typing import List
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from tasks.config_celery import celery_app

from config import RouteTags
from core.dependencies import get_redis
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
    edited_at: datetime | None = None,
    is_pinned: bool = False,
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
        edited_at=edited_at,
        is_pinned=is_pinned,
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

    merged: dict[uuid.UUID, MessageResponse] = {}
    for message in db_messages:
        merged[message.id] = await _build_message_response(
            message_id=message.id,
            chat_id=message.chat_id,
            user_id=message.user_id,
            text=message.text,
            created_at=message.created_at,
            attachments=message.attachments,
            reactions_count=message.reactions_count,
            user_reaction=reaction_by_message_id.get(message.id),
            reply_to_id=message.reply_to_id,
            reply_to_text=reply_texts.get(message.reply_to_id),
            edited_at=message.edited_at,
            is_pinned=message.id in pinned_ids,
        )

    pending_entries = await RedisDao.get_stream_entries(
        redis,
        message_queue_key(chat_id),
    )
    for _, fields in pending_entries:
        queued_message = MessageInternalDTO.model_validate_json(fields["payload"])
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
    if message.reply_to_id:
        replied_message = await MessageDao.get_reply_target(
            session,
            chat_id,
            message.reply_to_id,
        )
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
    return MessageHistory(
        messages=[
            await _build_message_response(
                message_id=row.id,
                chat_id=row.chat_id,
                user_id=row.user_id,
                text=row.text,
                created_at=row.created_at,
                attachments=row.attachments,
                reply_to_id=row.reply_to_id,
                edited_at=row.edited_at,
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
    await RedisDao.invalidate_history(redis, chat_id)
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
    response = await _build_message_response(
        message_id=updated.id,
        chat_id=updated.chat_id,
        user_id=updated.user_id,
        text=updated.text,
        created_at=updated.created_at,
        attachments=updated.attachments,
        reactions_count=updated.reactions_count,
        reply_to_id=updated.reply_to_id,
        edited_at=updated.edited_at,
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
