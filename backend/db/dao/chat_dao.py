import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.dao.basedao import BaseDao
from db.models import Chat, User


class ChatDao(BaseDao[Chat]):
    model = Chat

    @classmethod
    async def add_users_to_chat(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        new_user_ids: list[uuid.UUID],
    ) -> Chat | None:
        query = select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.users))
        result = await session.execute(query)
        chat = result.scalar_one_or_none()

        if not chat:
            return None

        users_query = select(User).where(User.id.in_(new_user_ids))
        users_result = await session.execute(users_query)
        new_users = users_result.scalars().all()

        for user in new_users:
            if user not in chat.users:
                chat.users.append(user)
        await session.flush()
        return chat

    @classmethod
    async def get_chat_with_users(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
    ) -> Chat:
        query = select(Chat).where(Chat.id == chat_id).options(selectinload(Chat.users))
        result = await session.execute(query)

        return result.scalar_one_or_none()
