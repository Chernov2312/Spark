import json
import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.dependencies import get_redis
from core.security import get_id_current_user
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao
from db.database import get_session
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.reactions import ReactionsRequest, ReactionsResponse


async def initialize_reactions(
    session: AsyncSession,
    redis: Redis,
    message_id: uuid.UUID,
) -> None:
    message = await MessageDao.get_by_id(session, message_id)
    reactions = await MessageReactionDao.get_message_reactions(session, message_id)
    await RedisDao.initialize_reaction_cache(
        redis,
        message_id=message_id,
        reactions_count=message.reactions_count if message is not None else {},
        user_reactions={reaction.user_id: reaction.emoji for reaction in reactions},
    )


async def publish_reaction_update(
    redis: Redis,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    user_id: uuid.UUID,
    user_reaction: str | None,
    counters: dict[str, str],
) -> dict[str, int]:
    reaction_counts = {
        key: int(value) for key, value in counters.items() if int(value) > 0
    }
    await RedisDao.publish_chat_event(
        redis,
        chat_id,
        json.dumps(
            {
                "event": "message:reactions",
                "data": {
                    "chat_id": str(chat_id),
                    "message_id": str(message_id),
                    "user_id": str(user_id),
                    "user_reaction": user_reaction,
                    "reactions_count": reaction_counts,
                },
            }
        ),
    )
    return reaction_counts


reactions_router = APIRouter(prefix="/api/v1/messages", tags=[RouteTags.REACTIONS])


@reactions_router.post("/{message_id}/reactions")
async def post_reactions(
    message_id: uuid.UUID,
    emoji: ReactionsRequest,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
    session: AsyncSession = Depends(get_session),
) -> ReactionsResponse:
    chat_id = await RedisDao.get_message_chat_id(redis, message_id)
    if chat_id is None:
        chat_id = await MessageDao.get_chat_id_by_message(session, message_id)
    chat = await ChatDao.get_chat_with_users(session, chat_id) if chat_id else None
    if chat is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=403, detail="You are not a member of this chat")
    await initialize_reactions(session, redis, message_id)
    current_counters = await RedisDao.set_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
        emoji=emoji.emoji,
    )
    await RedisDao.invalidate_history_for_message(redis, message_id, chat_id)
    reaction_counts = await publish_reaction_update(
        redis,
        chat_id,
        message_id,
        user_id,
        await redis.get(f"message:user_reaction:{message_id}:{user_id}"),
        current_counters,
    )
    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=reaction_counts,
    )


@reactions_router.delete("/{message_id}/reactions")
async def delete(
    message_id: uuid.UUID,
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
    session: AsyncSession = Depends(get_session),
) -> ReactionsResponse:
    chat_id = await RedisDao.get_message_chat_id(redis, message_id)
    if chat_id is None:
        chat_id = await MessageDao.get_chat_id_by_message(session, message_id)
    chat = await ChatDao.get_chat_with_users(session, chat_id) if chat_id else None
    if chat is None:
        raise HTTPException(status_code=404, detail="Message not found")
    if not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=403, detail="You are not a member of this chat")
    await initialize_reactions(session, redis, message_id)
    current_counters, removed = await RedisDao.remove_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
    )
    if removed:
        await RedisDao.invalidate_history_for_message(redis, message_id, chat_id)
        reaction_counts = await publish_reaction_update(
            redis,
            chat_id,
            message_id,
            user_id,
            None,
            current_counters,
        )
    else:
        reaction_counts = {
            key: int(value) for key, value in current_counters.items() if int(value) > 0
        }
    return ReactionsResponse(
        message_id=message_id,
        updated_reactions_count=reaction_counts,
    )
