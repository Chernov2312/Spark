import uuid

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_redis
from core.polls import create_poll, get_poll, vote_in_poll
from core.security import get_id_current_user
from db.database import get_session
from infrastructure.redis.client import Redis
from schemas.message import MessageResponse
from schemas.poll import PollCreate, PollResponse, PollVoteRequest

poll_router = APIRouter(prefix="/api/v1", tags=["Polls"])


@poll_router.post("/chats/{chat_id}/polls", status_code=201)
async def post_poll(
    chat_id: uuid.UUID,
    data: PollCreate,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> MessageResponse:
    return await create_poll(session, redis, chat_id, user_id, data)


@poll_router.get("/polls/{poll_id}")
async def read_poll(
    poll_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> PollResponse:
    return await get_poll(session, poll_id, user_id)


@poll_router.put("/polls/{poll_id}/vote")
async def put_vote(
    poll_id: uuid.UUID,
    data: PollVoteRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> PollResponse:
    return await vote_in_poll(session, redis, poll_id, user_id, data.option_id)


@poll_router.delete("/polls/{poll_id}/vote")
async def retract_vote(
    poll_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> PollResponse:
    return await vote_in_poll(session, redis, poll_id, user_id, None)
