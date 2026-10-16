import uuid
from datetime import datetime

from sqlalchemy import and_, delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import Chat, Message, User


class MessageDao(BaseDao[Message]):
    model = Message

    @classmethod
    async def get_chat_history(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int = 50,
        before: datetime = None,
    ) -> list[Message]:

        query = (
            select(Message)
            .where(
                and_(
                    Message.chat_id == chat_id,
                    Message.chat.has(Chat.users.any(User.id == user_id)),
                ),
            )
            .order_by(Message.created_at.desc())
            .limit(limit)
        )

        if before is not None:
            query = query.where(Message.created_at < before)

        res = await session.execute(query)
        return res.scalars().all()

    @classmethod
    async def update_by_id(
        cls,
        session: AsyncSession,
        target_id: uuid.UUID,
        user_id: uuid.UUID,
        text: str,
    ) -> Message | None:
        query = (
            update(Message)
            .where(
                Message.id == target_id,
                Message.user_id == user_id,
            )
            .values(text=text)
            .returning(Message)
        )

        res = await session.execute(query)

        return res.scalar_one_or_none()

    @classmethod
    async def delete_by_id(
        cls,
        session: AsyncSession,
        target_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        query = delete(Message).where(
            and_(Message.id == target_id, Message.user_id == user_id),
        )
        res = await session.execute(query)
        await session.flush()
        return res.rowcount > 0
