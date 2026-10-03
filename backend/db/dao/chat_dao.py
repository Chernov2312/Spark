import uuid

from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.dao.basedao import BaseDao
from db.models import Chat, user_chat


class ChatDao(BaseDao[Chat]):
    model = Chat

    @classmethod
    async def add_users_to_chat(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        new_user_ids: list[uuid.UUID],
    ) -> None:
        if not new_user_ids:
            return
        stmt = (
            postgresql.insert(user_chat)
            .values([{"chat_id": chat_id, "user_id": uid} for uid in new_user_ids])
            .on_conflict_do_nothing()
        )

        await session.execute(stmt)
        await session.flush()

    @classmethod
    async def get_chat_with_users(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
    ) -> Chat:
        query = select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.users))
        result = await session.execute(query)

        return result.scalar_one_or_none()
