import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config.ai import AIPrompts
from core.ai_service import AIService
from core.security import get_id_current_user
from db.dao.message_dao import Message, MessageDao
from db.database import get_session


async def get_ai_service() -> AIService:
    return AIService()


ai_router = APIRouter(prefix="/api/v1/ai")


@ai_router.post("/chats/{chat_id}/summarize")
async def get_chat_summary(
    chat_id: uuid.UUID,
    limit: int = 100,
    user_id: uuid.UUID = Depends(get_id_current_user),
    session: AsyncSession = Depends(get_session),
    ai_service: AIService = Depends(get_ai_service),
):
    messages: list[Message] = await MessageDao.get_chat_history(
        session=session,
        chat_id=chat_id,
        user_id=user_id,
        limit=limit,
    )
    if messages == []:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Empty chat",
        )
    prompt = "\n".join(f"{message.text}" for message in messages)
    await ai_service.generate_text(
        prompt=prompt,
        system_instruction=AIPrompts.GENERATE_SUMMARY,
    )
