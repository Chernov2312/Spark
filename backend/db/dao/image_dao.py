import uuid

from sqlalchemy import and_, delete
from sqlalchemy.ext.asyncio import AsyncSession

from db.dao.basedao import BaseDao
from db.models import Image


class ImageDao(BaseDao[Image]):
    model = Image

    @classmethod
    async def delete_image_by_url_and_user_id(
        cls, session: AsyncSession, target_url: str, user_id: uuid.UUID,
    ) -> bool:
        query = delete(Image).where(
            and_(Image.image_url == target_url, Image.user_id == user_id),
        )
        res = await session.execute(query)
        await session.flush()
        return res.rowcount > 0
