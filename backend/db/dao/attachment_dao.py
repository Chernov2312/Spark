import uuid

from sqlalchemy import and_, delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import Attachment


class AttachmentDao(BaseDao[Attachment]):
    model = Attachment

    @classmethod
    async def get_pending_message_attachments(
        cls,
        session: AsyncSession,
        chat_id: uuid.UUID,
        file_keys: list[str],
    ) -> list[Attachment]:
        if not file_keys:
            return []
        query = select(cls.model).where(
            cls.model.chat_id == chat_id,
            cls.model.file_key.in_(file_keys),
            cls.model.msg_id.is_(None),
            cls.model.is_avatar.is_(False),
        )
        result = await session.execute(query)
        return list(result.scalars().all())

    @classmethod
    async def get_avatar_by_url_and_user_id(
        cls,
        session: AsyncSession,
        target_url: str,
        user_id: uuid.UUID,
    ) -> Attachment | None:
        return await session.scalar(
            select(cls.model).where(
                cls.model.file_key == target_url,
                cls.model.user_id == user_id,
                cls.model.is_avatar.is_(True),
            ),
        )

    @classmethod
    async def delete_attachment_by_url_and_user_id(
        cls,
        session: AsyncSession,
        target_url: str,
        user_id: uuid.UUID,
    ) -> bool:
        query = delete(cls.model).where(
            and_(cls.model.file_key == target_url, cls.model.user_id == user_id),
        )
        res = await session.execute(query)
        await session.flush()
        return res.rowcount > 0
