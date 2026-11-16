import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import ChatAppearance


class ChatAppearanceDao:
    @classmethod
    async def get_avatar_keys(
        cls, session: AsyncSession, user_id: uuid.UUID, chat_ids: set[uuid.UUID],
    ) -> dict[uuid.UUID, str]:
        if not chat_ids:
            return {}
        result = await session.execute(
            select(ChatAppearance.chat_id, ChatAppearance.avatar_file_key).where(
                ChatAppearance.user_id == user_id,
                ChatAppearance.chat_id.in_(chat_ids),
            ),
        )
        return dict(result.all())

    @classmethod
    async def set_avatar(
        cls, session: AsyncSession, user_id: uuid.UUID,
        chat_id: uuid.UUID, file_key: str,
    ) -> None:
        await session.execute(
            insert(ChatAppearance).values(
                user_id=user_id, chat_id=chat_id, avatar_file_key=file_key,
            ).on_conflict_do_update(
                constraint="uq_chat_appearance_user_chat",
                set_={"avatar_file_key": file_key, "updated_at": func.now()},
            ),
        )

    @classmethod
    async def clear_avatar(
        cls, session: AsyncSession, user_id: uuid.UUID, chat_id: uuid.UUID,
    ) -> None:
        await session.execute(
            delete(ChatAppearance).where(
                ChatAppearance.user_id == user_id,
                ChatAppearance.chat_id == chat_id,
            ),
        )
