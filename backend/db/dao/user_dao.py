import uuid

from sqlalchemy import or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.dao.basedao import BaseDao
from db.models import User


class UserDao(BaseDao[User]):
    model = User

    @classmethod
    async def get_by_username_or_email(
        cls,
        session: AsyncSession,
        target: str,
    ) -> User | None:
        query = select(User).where(or_(User.username == target, User.email == target))
        res = await session.execute(query)
        return res.scalar_one_or_none()

    @classmethod
    async def get_user_with_chats(
        cls,
        session: AsyncSession,
        target_id: str,
    ) -> User | None:
        query = select(User).where(User.id == target_id).options(selectinload(User.chats))
        res = await session.execute(query)
        return res.scalar_one_or_none()

    @classmethod
    async def get_user_with_avatars(
        cls,
        session: AsyncSession,
        target_id: str,
    ) -> User | None:
        query = (
            select(User).where(User.id == target_id).options(selectinload(User.avatars))
        )
        res = await session.execute(query)
        return res.scalar_one_or_none()

    @classmethod
    async def update_by_id(
        cls,
        session: AsyncSession,
        target_id: uuid.UUID,
        data: dict,
    ) -> User | None:
        update_data = {k: v for k, v in data.items() if k != "id" and v is not None}
        if update_data:
            stmt = (
                update(cls.model)
                .where(cls.model.id == target_id)
                .values(**update_data)
                .execution_options(synchronize_session="fetch")
            )
            await session.execute(stmt)
        query = (
            select(cls.model)
            .where(cls.model.id == target_id)
            .options(selectinload(cls.model.avatars))
        )
        res = await session.execute(query)
        return res.scalar_one_or_none()
