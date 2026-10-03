from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models.user import User


class UserDao(BaseDao[User]):
    model = User

    @classmethod
    async def get_by_username(
        cls,
        session: AsyncSession,
        target_username: str,
    ) -> User:
        query = select(User).where(User.username == target_username)
        res = await session.execute(query)
        return res.scalar_one_or_none()
