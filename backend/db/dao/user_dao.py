from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import User


class UserDao(BaseDao[User]):
    model = User

    @classmethod
    async def get_by_username_or_email(
        cls,
        session: AsyncSession,
        target: str,
    ) -> User:
        query = select(User).where(or_(User.username == target, User.email == target))
        res = await session.execute(query)
        return res.scalar_one_or_none()
