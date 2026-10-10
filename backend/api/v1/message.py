import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_id_current_user
from db.dao.message_dao import MessageDao
from db.database import get_session
from db.models import Message
from schemas.message import MessageHistory, MessageRequest, MessageResponse

message_router = APIRouter(prefix="/api/v1", tags=[RouteTags.MESSAGES])
status.HTTP_422_UNPROCESSABLE_CONTENT


@message_router.get("/chats/{chat_id}/messages", status_code=status.HTTP_200_OK)
async def get_messages_history(
    chat_id: uuid.UUID,
    limit: int = 50,
    before: datetime = None,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> MessageHistory:
    db_messages: List[Message] = await MessageDao.get_chat_history(
        session=session,
        chat_id=chat_id,
        user_id=user_id,
        limit=limit,
        before=before,
    )
    return MessageHistory(messages=db_messages)


@message_router.post("/chats/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: uuid.UUID,
    message: MessageRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> MessageResponse:
    message_db: Message = await MessageDao.add(
        session=session,
        data={
            "user_id": user_id,
            "text": message.text,
            "attachments": message.attachment,
            "chat_id": chat_id,
        },
    )
    await session.commit()
    return message_db


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
