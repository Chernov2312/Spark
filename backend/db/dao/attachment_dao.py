import uuid

from sqlalchemy import and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import Attachment


class AttachmentDao(BaseDao[Attachment]):
    model = Attachment

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
