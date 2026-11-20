import uuid

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import PushSubscription, user_chat
from schemas.push import PushSubscriptionRequest


class PushSubscriptionDao:
    @staticmethod
    async def upsert(
        session: AsyncSession, user_id: uuid.UUID, request: PushSubscriptionRequest
    ) -> bool:
        statement = insert(PushSubscription).values(
            user_id=user_id,
            endpoint=request.endpoint,
            p256dh=request.keys.p256dh,
            auth_secret=request.keys.auth,
            chat_options={
                str(chat_id): options.model_dump()
                for chat_id, options in request.chat_options.items()
            },
        )
        result = await session.scalar(
            statement.on_conflict_do_update(
                index_elements=[PushSubscription.endpoint],
                set_={
                    "user_id": statement.excluded.user_id,
                    "p256dh": statement.excluded.p256dh,
                    "auth_secret": statement.excluded.auth_secret,
                    "chat_options": statement.excluded.chat_options,
                    "updated_at": func.now(),
                },
                where=or_(
                    PushSubscription.user_id == user_id,
                    and_(
                        PushSubscription.p256dh == statement.excluded.p256dh,
                        PushSubscription.auth_secret == statement.excluded.auth_secret,
                    ),
                ),
            ).returning(PushSubscription.id)
        )
        return result is not None

    @staticmethod
    async def remove(session: AsyncSession, user_id: uuid.UUID, endpoint: str) -> None:
        await session.execute(
            delete(PushSubscription).where(
                PushSubscription.user_id == user_id,
                PushSubscription.endpoint == endpoint,
            )
        )

    @staticmethod
    async def list_for_chat(
        session: AsyncSession, chat_id: uuid.UUID, sender_id: uuid.UUID
    ) -> list[PushSubscription]:
        result = await session.scalars(
            select(PushSubscription)
            .join(user_chat, user_chat.c.user_id == PushSubscription.user_id)
            .where(user_chat.c.chat_id == chat_id, PushSubscription.user_id != sender_id)
        )
        return list(result)

    @staticmethod
    async def remove_expired(
        session: AsyncSession, subscription: PushSubscription
    ) -> None:
        await session.execute(
            delete(PushSubscription).where(
                PushSubscription.id == subscription.id,
                PushSubscription.user_id == subscription.user_id,
                PushSubscription.updated_at == subscription.updated_at,
            )
        )
