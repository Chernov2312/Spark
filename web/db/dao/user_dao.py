from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db.models.user import User
from web.db.dao.basedao import BaseDao


class UserDao(BaseDao[User]):
    @classmethod
    async def get_by_username(
        cls,
        session: AsyncSession,
        target_username: str,
    ) -> User:
        query = select(User).where(User.username == target_username)
        res = await session.execute(query)
        return res.scalar_one_or_none()
