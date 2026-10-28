import json
import uuid
from datetime import datetime
from typing import List

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.dependencies import get_redis
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao
from db.database import get_session
from db.models import Message, MessageReaction
from schemas.message import (
    AttachmentRequest,
    MessageHistory,
    MessageInternalDTO,
    MessageRequest,
    MessageResponse,
)

message_router = APIRouter(prefix="/api/v1", tags=[RouteTags.MESSAGES])
status.HTTP_422_UNPROCESSABLE_CONTENT


@message_router.get("/chats/{chat_id}/messages", status_code=status.HTTP_200_OK)
async def get_messages_history(
    chat_id: uuid.UUID,
    limit: int = 50,
    before: datetime = None,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
    redis: aioredis.Redis = Depends(get_redis),
) -> MessageHistory:
    db_messages: List[Message] = await MessageDao.get_chat_history(
        session=session,
        chat_id=chat_id,
        user_id=user_id,
        limit=limit,
        before=before,
    )
    s3 = S3Storage()
    validated_messages = []
    messages_id: List[uuid.UUID] = [i.chat_id for i in db_messages]
    user_reactions: List[MessageReaction] = await MessageReactionDao.get_user_reactions(
        session=session,
        user_id=user_id,
        loaded_message_ids=messages_id,
    )
    message_reactions_ids: List[uuid.UUID] = {
        i.message_id: i.emoji for i in user_reactions
    }
    for msg in db_messages:
        signed_attachments = []
        if msg.attachments:
            for file_key in msg.attachments:
                url = await s3.get_temporary_url(file_key.attachment_url)
                signed_attachments.append(
                    AttachmentRequest(
                        attachment_url=url,
                        file_name=file_key.file_name,
                        file_size=file_key.file_size,
                        mime_type=file_key.mime_type,
                        text=file_key.text,
                    ),
                )
        if msg.id in message_reactions_ids:
            msg.user_reaction = message_reactions_ids[msg.id]

        validated_messages.append(
            MessageResponse(
                id=msg.id,
                chat_id=msg.chat_id,
                user_id=msg.user_id,
                text=msg.text,
                user_reaction=(
                    message_reactions_ids[msg.id]
                    if msg.id in message_reactions_ids
                    else None
                ),
                attachments=signed_attachments,
                reactions_count=msg.reactions_count,
                created_at=msg.created_at,
            ),
        )
    return MessageHistory(messages=validated_messages)


@message_router.post("/chats/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: uuid.UUID,
    message: MessageRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: aioredis.Redis = Depends(get_redis),
) -> MessageResponse:
    s3 = S3Storage()
    message_id: uuid.UUID = uuid.uuid4()
    chat_key_hash = f"chat:{chat_id}"
    chat_set_key = "chats"
    clean = []
    for i in message.attachments:
        i.attachment_url = s3.get_file_key(i.attachment_url)
        clean.append(i)
    message.attachments = clean.copy()
    message_redis = MessageInternalDTO(
        text=message.text,
        attachments=message.attachments,
        user_id=user_id,
        id=message_id,
        chat_id=chat_id,
    )
    async with redis.pipeline(transaction=False) as pipe:
        pipe.hset(chat_key_hash, str(message_id), message_redis.model_dump_json())
        pipe.sadd(chat_set_key, str(chat_id))
        await pipe.execute()
    message_db: Message = await MessageDao.create_with_attachments(
        session=session,
        data={
            "user_id": user_id,
            "text": message.text,
            "chat_id": chat_id,
        },
        attachments=[a.model_dump() for a in message.attachments],
    )
    await redis.publish(
        f"chat:{chat_id}",
        json.dumps(
            {
                "event": "message:new",
                "data": {
                    "id": str(message_db.id),
                    "chat_id": str(chat_id),
                    "text": message_db.text,
                    "user_id": str(user_id),
                    "created_at": message_db.created_at.isoformat(),
                },
            },
        ),
    )
    await session.commit()
    signed_attachments = []
    if message_db.attachments:
        for file_key in message_db.attachments:
            url = await s3.get_temporary_url(file_key.attachment_url)
            signed_attachments.append(
                AttachmentRequest(
                    attachment_url=url,
                    file_name=file_key.file_name,
                    file_size=file_key.file_size,
                    mime_type=file_key.mime_type,
                    text=file_key.text,
                ),
            )
    valid = MessageResponse(
        id=message_db.id,
        chat_id=message_db.chat_id,
        user_id=message_db.user_id,
        text=message_db.text,
        user_reaction=None,
        attachments=signed_attachments,
        reactions_count=message_db.reactions_count,
        created_at=message_db.created_at,
    )
    return valid


@message_router.put("/messages/{message_id}")
async def update_message(
    message_id: uuid.UUID,
    message: MessageRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> MessageResponse:

    res = await MessageDao.update_by_id(
        session=session,
        target_id=message_id,
        data={"text": message.text, "user_id": user_id},
    )
    if res is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found or you don't have permission to edit it",
        )
    await session.commit()
    return res


@message_router.delete("/messages/{message_id}")
async def delete_message(
    message_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> MessageResponse:

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
    await session.commit()
    return res
