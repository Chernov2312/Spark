import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from dao.basedao import BaseDao
from db.models.chat import Chat


class ChatDao(BaseDao[Chat]):
    @classmethod
    async def get_chat_with_users(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
    ) -> Chat:
        query = select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.users))
        result = await session.execute(query)

        return result.scalar_one_or_none()
