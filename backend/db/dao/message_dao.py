from collections.abc import Sequence
from datetime import datetime
from typing import Protocol, TypedDict
import uuid

from sqlalchemy import and_, bindparam, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.dao.basedao import BaseDao
from db.models import Attachment, Chat, Message, MessagePin, User


class QueuedAttachment(Protocol):
    id: uuid.UUID | None
    text: str | None


class QueuedMessage(Protocol):
    id: uuid.UUID
    chat_id: uuid.UUID
    user_id: uuid.UUID
    text: str | None
    reply_to_id: uuid.UUID | None
    created_at: datetime
    attachments: Sequence[QueuedAttachment]


class MessageReactionData(TypedDict):
    id: uuid.UUID
    users: dict[str, str]
    reactions_count: dict[str, int]


class MessageDao(BaseDao[Message]):
    model = Message

    @classmethod
    async def get_with_attachments(
        cls,
        session: AsyncSession,
        message_id: uuid.UUID,
    ) -> Message | None:
        result = await session.execute(
            select(Message)
            .where(Message.id == message_id)
            .options(selectinload(Message.attachments)),
        )
        return result.scalar_one_or_none()

    @classmethod
    async def get_reply_target(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        message_id: uuid.UUID,
    ) -> Message | None:
        return await session.scalar(
            select(Message).where(
                Message.id == message_id,
                Message.chat_id == chat_id,
            ),
        )

    @classmethod
    async def get_pinned_message_ids(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
    ) -> set[uuid.UUID]:
        result = await session.scalars(
            select(MessagePin.message_id).where(MessagePin.chat_id == chat_id),
        )
        return set(result.all())

    @classmethod
    async def get_message_texts(
        cls,
        session: AsyncSession,
        message_ids: set[uuid.UUID],
    ) -> dict[uuid.UUID, str | None]:
        if not message_ids:
            return {}
        result = await session.execute(
            select(Message.id, Message.text).where(Message.id.in_(message_ids)),
        )
        return dict(result.all())

    @classmethod
    async def toggle_pin(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        message_id: uuid.UUID,
        pinned_by: uuid.UUID,
    ) -> bool | None:
        message = await cls.get_reply_target(session, chat_id, message_id)
        if message is None:
            return None
        pin = await session.scalar(
            select(MessagePin).where(
                MessagePin.chat_id == chat_id,
                MessagePin.message_id == message_id,
            ),
        )
        if pin is not None:
            await session.delete(pin)
            pinned = False
        else:
            session.add(
                MessagePin(
                    chat_id=chat_id,
                    message_id=message_id,
                    pinned_by=pinned_by,
                ),
            )
            pinned = True
        await session.flush()
        return pinned

    @classmethod
    async def create_with_attachments(
        cls,
        session: AsyncSession,
        data: dict[str, object],
        attachments: list[dict[str, object]],
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
        before: datetime | None = None,
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
    async def search_chat_history(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        query_text: str | None = None,
        author_id: uuid.UUID | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        attachment_type: str | None = None,
        limit: int = 100,
    ) -> list[Message]:
        query = select(Message).where(
            Message.chat_id == chat_id,
            Message.chat.has(Chat.users.any(User.id == user_id)),
        )
        if query_text:
            pattern = f"%{query_text.strip()}%"
            query = query.where(
                or_(
                    Message.text.ilike(pattern),
                    Message.attachments.any(Attachment.file_name.ilike(pattern)),
                ),
            )
        if author_id:
            query = query.where(Message.user_id == author_id)
        if since:
            query = query.where(Message.created_at >= since)
        if until:
            query = query.where(Message.created_at <= until)
        if attachment_type:
            patterns = {
                "image": "image/%",
                "video": "video/%",
                "audio": "audio/%",
                "file": "application/%",
            }
            mime_pattern = patterns.get(attachment_type)
            if mime_pattern is None:
                return []
            query = query.where(
                Message.attachments.any(Attachment.mime_type.like(mime_pattern)),
            )
        result = await session.execute(
            query.order_by(Message.created_at.desc())
            .limit(min(max(limit, 1), 200))
            .options(selectinload(Message.attachments)),
        )
        return result.scalars().all()

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
            .values(text=text, edited_at=func.now())
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
    ) -> None:
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
        data_messages: Sequence[QueuedMessage],
    ) -> None:
        if not data_messages:
            return
        values = [
            {
                "id": message.id,
                "chat_id": message.chat_id,
                "user_id": message.user_id,
                "text": message.text,
                "reply_to_id": message.reply_to_id,
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
        data_messages: Sequence[QueuedMessage],
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
