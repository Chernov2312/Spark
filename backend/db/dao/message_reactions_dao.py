from typing import TypedDict
import uuid

from sqlalchemy import and_, delete, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import MessageReaction


class MessageReactionData(TypedDict):
    id: uuid.UUID
    users: dict[str, str]
    reactions_count: dict[str, int]


class MessageReactionDao(BaseDao[MessageReaction]):
    model = MessageReaction

    @classmethod
    async def get_message_reactions(
        cls,
        session: AsyncSession,
        message_id: uuid.UUID,
    ) -> list[MessageReaction]:
        result = await session.execute(
            select(MessageReaction).where(cls.model.message_id == message_id),
        )
        return list(result.scalars().all())

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
    ) -> None:
        message_ids = [uuid.UUID(str(message["id"])) for message in message_reactions]
        if not message_ids:
            return

        await session.execute(
            delete(cls.model).where(cls.model.message_id.in_(message_ids)),
        )
        users_data = []
        for msg in message_reactions:
            message_id = uuid.UUID(str(msg["id"]))
            for user_id_str, emoji in msg["users"].items():
                users_data.append(
                    {
                        "user_id": uuid.UUID(user_id_str),
                        "message_id": message_id,
                        "emoji": emoji,
                    },
                )

        if users_data:
            await session.execute(insert(cls.model), users_data)
