from datetime import datetime
import uuid

from sqlalchemy import delete, update
from sqlalchemy.ext.asyncio import AsyncSession

from db.models import RefreshSession


class RefreshSessionDao:
    @staticmethod
    async def create(
        session: AsyncSession,
        user_id: uuid.UUID,
        token_hash: str,
        expires_at: datetime,
        now: datetime,
    ) -> None:
        await session.execute(
            delete(RefreshSession).where(
                RefreshSession.user_id == user_id,
                RefreshSession.expires_at <= now,
            )
        )
        session.add(
            RefreshSession(user_id=user_id, token_hash=token_hash, expires_at=expires_at)
        )
        await session.flush()

    @staticmethod
    async def rotate(
        session: AsyncSession,
        token_hash: str,
        new_token_hash: str,
        now: datetime,
    ) -> tuple[uuid.UUID, datetime] | None:
        result = await session.execute(
            update(RefreshSession)
            .where(
                RefreshSession.token_hash == token_hash,
                RefreshSession.expires_at > now,
            )
            .values(token_hash=new_token_hash)
            .returning(RefreshSession.user_id, RefreshSession.expires_at)
        )
        row = result.one_or_none()
        return (row.user_id, row.expires_at) if row else None

    @staticmethod
    async def revoke(session: AsyncSession, token_hash: str) -> None:
        await session.execute(
            delete(RefreshSession).where(RefreshSession.token_hash == token_hash)
        )

    @staticmethod
    async def revoke_for_user(session: AsyncSession, user_id: uuid.UUID) -> None:
        await session.execute(
            delete(RefreshSession).where(RefreshSession.user_id == user_id)
        )
