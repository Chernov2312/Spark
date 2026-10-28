import uuid
from datetime import datetime
from typing import TypedDict

from sqlalchemy import and_, bindparam, delete, insert, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.dao.basedao import BaseDao
from db.models import Attachment, Chat, Message, User


class MessageReactionData(TypedDict):
    id: uuid.UUID
    users: dict[uuid.UUID, str]
    reactions_count: dict[str, int]


class MessageDao(BaseDao[Message]):
    model = Message

    @classmethod
    async def create_with_attachments(
        cls,
        session: AsyncSession,
        data: dict,
        attachments: list[dict],
    ) -> Message:
        message = Message(**data)
        message.attachments = [Attachment(**a) for a in attachments]
        session.add(message)
        await session.flush()
        return message

    @classmethod
    async def get_chat_history(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int = 50,
        before: datetime = None,
    ) -> list[Message]:

        query = (
            select(Message)
            .where(
                and_(
                    Message.chat_id == chat_id,
                    Message.chat.has(Chat.users.any(User.id == user_id)),
                ),
            )
            .order_by(Message.created_at.desc())
            .limit(limit)
            .options(selectinload(Message.attachments))
        )

        if before is not None:
            query = query.where(Message.created_at < before)

        res = await session.execute(query)
        return res.scalars().all()

    @classmethod
    async def update_by_id(
        cls,
        session: AsyncSession,
        target_id: uuid.UUID,
        user_id: uuid.UUID,
        text: str,
    ) -> Message | None:
        query = (
            update(Message)
            .where(
                Message.id == target_id,
                Message.user_id == user_id,
            )
            .values(text=text)
            .returning(Message)
        )

        res = await session.execute(query)

        return res.scalar_one_or_none()

    @classmethod
    async def delete_by_id(
        cls,
        session: AsyncSession,
        target_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> bool:
        query = delete(Message).where(
            and_(Message.id == target_id, Message.user_id == user_id),
        )
        res = await session.execute(query)
        await session.flush()
        return res.rowcount > 0

    @classmethod
    async def update_msg_reactions_by_ids(
        cls,
        session: AsyncSession,
        message_reactions: list[MessageReactionData],
    ):
        stmt = (
            update(cls.model)
            .where(
                cls.model.id == bindparam("b_id"),
            )
            .values(
                reactions_count=bindparam("reactions_count"),
            )
            .execution_options(synchronize_session=None)
        )
        formatted_reactions = [{**r, "b_id": r["id"]} for r in message_reactions]

        await session.execute(stmt, formatted_reactions)

    @classmethod
    async def bulk_insert_messages(
        cls,
        session: AsyncSession,
        data_messages,
    ):
        await session.execute(insert(Message), data_messages)
