from typing import TypedDict
import uuid

from sqlalchemy import and_, bindparam, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import MessageReaction


class MessageReactionData(TypedDict):
    id: uuid.UUID
    users: dict[uuid.UUID, str]
    reactions_count: dict[str, int]


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

    @classmethod
    async def update_user_reactions(
        cls,
        session: AsyncSession,
        message_reactions: list[MessageReactionData],
    ):
        users_data = []
        for msg in message_reactions:
            message_id = uuid.UUID(str(msg["id"]))
            for user_id_str, emoji in msg["users"].items():
                users_data.append(
                    {
                        "b_user_id": uuid.UUID(user_id_str),
                        "b_message_id": message_id,
                        "emoji": emoji,
                    },
                )

        if not users_data:
            return

        stmt = (
            update(cls.model)
            .where(
                cls.model.user_id == bindparam("b_user_id"),
                cls.model.message_id == bindparam("b_message_id"),
            )
            .values(
                emoji=bindparam("emoji"),
            )
        )

        conn = await session.connection()
        await conn.execute(stmt, users_data)
