import uuid
from datetime import datetime
from typing import List

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import get_id_current_user
from db.dao.message_dao import MessageDao
from db.database import get_session
from db.models import Message
from schemas.message import MessageCreate, MessageHistory, MessageResponse

message_router = APIRouter(prefix="/api/v1/chats")


@message_router.get("/{chat_id}/messages", status_code=status.HTTP_200_OK)
async def get_messages_history(
    chat_id: uuid.UUID,
    limit: int = 50,
    before: datetime = None,
    session: AsyncSession = Depends(get_session),
    _: str = Depends(get_id_current_user),
) -> MessageHistory:
    db_messages: List[Message] = await MessageDao.get_chat_history(
        session=session,
        chat_id=chat_id,
        limit=limit,
        before=before,
    )
    return MessageHistory(messages=db_messages)


@message_router.post("/{chat_id}/messages", status_code=status.HTTP_201_CREATED)
async def create_message(
    chat_id: uuid.UUID,
    message: MessageCreate,
    session: AsyncSession = Depends(get_session),
    user_id: str = Depends(get_id_current_user),
) -> MessageResponse:
    message_db: Message = await MessageDao.add(
        session=session,
        data={"user_id": user_id, "text": message.text, "chat_id": chat_id},
    )
    return message_db
