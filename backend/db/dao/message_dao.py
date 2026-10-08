import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import Message


class MessageDao(BaseDao[Message]):
    model = Message

    @classmethod
    async def get_chat_history(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        limit: int = 50,
        before: datetime = None,
    ):

        query = (
            select(cls.model)
            .where(cls.model.chat_id == chat_id)
            .order_by(cls.model.created_at.desc())
            .limit(limit)
        )

        if before is not None:
            query = query.where(cls.model.created_at < before)

        res = await session.execute(query)
        return res.scalars().all()
