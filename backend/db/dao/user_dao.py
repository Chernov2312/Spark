from sqlalchemy import or_, select
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
<<<<<<< HEAD
        res = await session.execute(query)
        return res.scalar_one_or_none()
=======
        result = await session.execute(query)

        return result.scalar_one_or_none()
>>>>>>> c76561489f0346c19b025be1d72df8051662e439
