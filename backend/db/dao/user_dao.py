import re
import uuid

from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only, selectinload

from core.user_tags import normalize_user_tag
from db.dao.basedao import BaseDao
from db.models import Chat, Message, User


class UserDao(BaseDao[User]):
    model = User

    @classmethod
    async def delete_all_with_messages(cls, session: AsyncSession) -> int:
        """Clear user data; the caller owns the transaction and its commit."""
        await session.execute(delete(Message))
        result = await session.execute(delete(User))
        await session.flush()
        return result.rowcount

    @classmethod
    async def get_by_tag(cls, session: AsyncSession, tag: str) -> User | None:
        result = await session.execute(
            select(User).where(User.tag == normalize_user_tag(tag))
        )
        return result.scalar_one_or_none()

    @classmethod
    async def available_tag(cls, session: AsyncSession, display_name: str) -> str:
        base = normalize_user_tag(display_name)
        candidate = base
        suffix = 1
        while await cls.get_by_tag(session, candidate):
            suffix += 1
            tail = str(suffix)
            candidate = f"{base[: 32 - len(tail)]}{tail}"
        return candidate

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
    async def get_by_email_case_insensitive(
        cls,
        session: AsyncSession,
        email: str,
    ) -> User | None:
        return await session.scalar(
            select(User).where(func.lower(User.email) == email.casefold()),
        )

    @classmethod
    async def reset_password(
        cls,
        session: AsyncSession,
        user_id: uuid.UUID,
        password_hash: str,
    ) -> User | None:
        user = await cls.get_by_id(session, user_id)
        if user is None:
            return None
        user.password = password_hash
        await session.flush()
        return user

    @classmethod
    async def mark_verified(
        cls,
        session: AsyncSession,
        user_id: uuid.UUID,
    ) -> User | None:
        user = await cls.get_by_id(session, user_id)
        if user is None:
            return None
        if not user.is_verified:
            user.is_verified = True
            await session.flush()
        return user

    @classmethod
    async def find_by_username(
        cls,
        session: AsyncSession,
        target: str,
    ) -> list[User]:
        safe = re.escape(target)
        reg = rf"^{safe}"
        query = (
            select(User)
            .where(or_(User.tag.op("~*")(reg), User.username.op("~*")(reg)))
            .options(load_only(User.id, User.username, User.tag))
        )
        res = await session.execute(query)
        return res.scalars().all()

    @classmethod
    async def get_user_with_chats(
        cls,
        session: AsyncSession,
        target_id: uuid.UUID,
    ) -> User | None:
        query = (
            select(User)
            .where(User.id == target_id)
            .options(
                selectinload(User.chats).selectinload(Chat.avatars),
                selectinload(User.chats).selectinload(Chat.users),
            )
        )
        res = await session.execute(query)
        return res.scalar_one_or_none()

    @classmethod
    async def get_user_with_avatars(
        cls,
        session: AsyncSession,
        target_id: uuid.UUID,
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
        data: dict[str, object],
    ) -> User | None:
        nullable_fields = {"bio", "birth_date"}
        update_data = {
            k: v
            for k, v in data.items()
            if k != "id" and (v is not None or k in nullable_fields)
        }
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
