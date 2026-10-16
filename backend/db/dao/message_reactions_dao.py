import uuid

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import MessageReaction


class MessageReactionDao(BaseDao[MessageReaction]):
    model = MessageReaction

    @classmethod
    async def get_user_reactions(
        cls,
        session: AsyncSession,
        user_id: uuid.UUID,
        loaded_message_ids: list[uuid.UUID],
    ) -> list[MessageReaction]:
        query = select(MessageReaction).where(
            and_(
                cls.model.user_id == user_id,
                cls.model.message_id.in_(loaded_message_ids),
            ),
        )
        res = await session.execute(query)
        return res.scalars().all()
