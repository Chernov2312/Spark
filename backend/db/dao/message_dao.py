import uuid
from datetime import datetime
from typing import TypedDict

from sqlalchemy import and_, bindparam, delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
    async def get_chat_id_by_message(
        cls,
        session: AsyncSession,
        message_id: uuid.UUID,
    ) -> uuid.UUID | None:
        query = select(Message.chat_id).where(Message.id == message_id)
        result = await session.execute(query)
        return result.scalar_one_or_none()

    @classmethod
    async def update_msg_reactions_by_ids(
        cls,
        session: AsyncSession,
        message_reactions: list[MessageReactionData],
    ):
        if not message_reactions:
            return
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
        if not data_messages:
            return
        values = [
            {
                "id": message.id,
                "chat_id": message.chat_id,
                "user_id": message.user_id,
                "text": message.text,
                "created_at": message.created_at,
            }
            for message in data_messages
        ]
        statement = (
            pg_insert(Message)
            .values(values)
            .on_conflict_do_nothing(
                index_elements=[Message.id],
            )
        )
        await session.execute(statement)

    @classmethod
    async def attach_queued_attachments(
        cls,
        session: AsyncSession,
        data_messages,
    ) -> None:
        from db.models import Attachment

        for message in data_messages:
            for attachment in message.attachments:
                if attachment.id is None:
                    raise ValueError("Queued attachment is missing its database ID")
                statement = (
                    update(Attachment)
                    .where(
                        Attachment.id == attachment.id,
                        or_(
                            Attachment.msg_id.is_(None),
                            Attachment.msg_id == message.id,
                        ),
                    )
                    .values(
                        msg_id=message.id,
                        **(
                            {"text": attachment.text}
                            if attachment.text is not None
                            else {}
                        ),
                    )
                )
                result = await session.execute(statement)
                if result.rowcount != 1:
                    raise ValueError(
                        f"Queued attachment {attachment.id} no longer exists "
                        "or is in use",
                    )
