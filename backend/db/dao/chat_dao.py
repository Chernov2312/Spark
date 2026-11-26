from datetime import datetime
import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.dao.basedao import BaseDao
from db.models import Attachment, Chat, ChatReadState, Message, User, user_chat


class ChatDao(BaseDao[Chat]):
    model = Chat

    @classmethod
    async def get_missing_user_ids(
        cls,
        session: AsyncSession,
        user_ids: list[uuid.UUID],
    ) -> set[uuid.UUID]:
        requested_ids = set(user_ids)
        if not requested_ids:
            return set()
        query = select(User.id).where(User.id.in_(requested_ids))
        result = await session.execute(query)
        existing_ids = set(result.scalars().all())
        return requested_ids - existing_ids

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
        *,
        include_avatars: bool = False,
    ) -> Chat | None:
        users = selectinload(Chat.users)
        if include_avatars:
            users = users.selectinload(User.avatars.and_(Attachment.chat_id.is_(None)))
        query = (
            select(Chat)
            .where(Chat.id == chat_id)
            .options(users)
            .execution_options(populate_existing=True)
        )
        result = await session.execute(query)

        return result.scalar_one_or_none()

    @classmethod
    async def get_member_roles(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
    ) -> dict[uuid.UUID, str]:
        result = await session.execute(
            select(user_chat.c.user_id, user_chat.c.role).where(
                user_chat.c.chat_id == chat_id,
            ),
        )
        return dict(result.all())

    @classmethod
    async def get_read_states(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
    ) -> dict[uuid.UUID, uuid.UUID | None]:
        result = await session.execute(
            select(
                ChatReadState.user_id,
                ChatReadState.last_read_message_id,
            ).where(ChatReadState.chat_id == chat_id),
        )
        return dict(result.all())

    @classmethod
    async def set_member_role(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        member_id: uuid.UUID,
        role: str,
    ) -> bool:
        result = await session.execute(
            update(user_chat)
            .where(
                user_chat.c.chat_id == chat_id,
                user_chat.c.user_id == member_id,
            )
            .values(role=role),
        )
        return result.rowcount == 1

    @classmethod
    async def remove_member(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        member_id: uuid.UUID,
    ) -> bool:
        result = await session.execute(
            delete(user_chat).where(
                user_chat.c.chat_id == chat_id,
                user_chat.c.user_id == member_id,
            ),
        )
        return result.rowcount == 1

    @classmethod
    async def delete_chat(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
    ) -> bool:
        await session.execute(delete(Message).where(Message.chat_id == chat_id))
        return await cls.delete_by_id(session, chat_id)

    @classmethod
    async def is_message_in_chat(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        message_id: uuid.UUID,
    ) -> bool:
        result = await session.scalar(
            select(Message.id).where(
                Message.id == message_id,
                Message.chat_id == chat_id,
            ),
        )
        return result is not None

    @classmethod
    async def mark_read(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        message_id: uuid.UUID | None,
        read_at: datetime,
    ) -> None:
        insert = postgresql.insert(ChatReadState).values(
            chat_id=chat_id,
            user_id=user_id,
            last_read_message_id=message_id,
            last_read_at=read_at,
        )
        await session.execute(
            insert.on_conflict_do_update(
                constraint="uq_chat_read_user",
                set_={
                    "last_read_message_id": insert.excluded.last_read_message_id,
                    "last_read_at": insert.excluded.last_read_at,
                    "updated_at": read_at,
                },
            ),
        )

    @classmethod
    async def set_owner_role(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        owner_id: uuid.UUID,
    ) -> bool:
        return await cls.set_member_role(session, chat_id, owner_id, "owner")

    @classmethod
    async def update_chat_fields(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        *,
        title: str | None,
        description: str | None,
    ) -> Chat | None:
        chat = await cls.get_by_id(session, chat_id)
        if chat is None:
            return None
        if title is not None:
            chat.title = title
        if description is not None:
            chat.description = description
        await session.flush()
        await session.refresh(chat)
        return chat
