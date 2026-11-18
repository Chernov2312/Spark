import json
import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.message_actions import ensure_chat_member, queued_messages
from db.dao.message_dao import MessageDao
from db.dao.poll_dao import PollDao
from db.models.poll import Poll
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import MessageInternalDTO, MessageResponse
from schemas.poll import PollCreate, PollOptionResponse, PollResponse, PollVoter


def poll_response(poll: Poll, user_id: uuid.UUID) -> PollResponse:
    my_vote = next((vote for vote in poll.votes if vote.user_id == user_id), None)
    can_see_correct = poll.is_quiz and (my_vote is not None or user_id == poll.creator_id)
    return PollResponse(
        id=poll.id,
        message_id=poll.message_id,
        chat_id=poll.chat_id,
        question=poll.question,
        is_anonymous=poll.is_anonymous,
        allow_retract=poll.allow_retract,
        is_quiz=poll.is_quiz,
        is_creator=poll.creator_id == user_id,
        total_votes=len(poll.votes),
        my_option_id=my_vote.option_id if my_vote else None,
        correct_option_id=next(
            (
                option.id
                for option in poll.options
                if option.position == poll.correct_option_index
            ),
            None,
        )
        if can_see_correct
        else None,
        version=poll.version,
        options=[
            PollOptionResponse(
                id=option.id,
                text=option.text,
                votes_count=sum(vote.option_id == option.id for vote in poll.votes),
                voters=None
                if poll.is_anonymous
                else [
                    PollVoter(
                        id=vote.user.id,
                        username=vote.user.username,
                        tag=vote.user.tag,
                    )
                    for vote in poll.votes
                    if vote.option_id == option.id
                ],
            )
            for option in poll.options
        ],
    )


async def get_poll(
    session: AsyncSession,
    poll_id: uuid.UUID,
    user_id: uuid.UUID,
) -> PollResponse:
    poll = await PollDao.get(session, poll_id)
    if poll is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    await ensure_chat_member(session, poll.chat_id, user_id)
    return poll_response(poll, user_id)


async def create_poll(
    session: AsyncSession,
    redis: Redis,
    chat_id: uuid.UUID,
    user_id: uuid.UUID,
    data: PollCreate,
) -> MessageResponse:
    await ensure_chat_member(session, chat_id, user_id)
    if data.thread_root_id is not None:
        root = await MessageDao.get_reply_target(session, chat_id, data.thread_root_id)
        pending = []
        if root is None:
            pending = await queued_messages(redis, chat_id)
            root = next(
                (item for item in pending if item.id == data.thread_root_id),
                None,
            )
        if root is None or root.thread_root_id is not None:
            raise HTTPException(
                status_code=422,
                detail="Thread root must be a top-level message in this chat",
            )
        if isinstance(root, MessageInternalDTO):
            # Use the worker's idempotent persistence path before adding an FK to a queued root.
            await MessageDao.bulk_insert_messages(session, pending)
            await MessageDao.attach_queued_attachments(session, pending)
    message = await MessageDao.create_with_attachments(
        session,
        {
            "chat_id": chat_id,
            "user_id": user_id,
            "text": data.question,
            "thread_root_id": data.thread_root_id,
        },
        [],
    )
    poll = await PollDao.create(
        session,
        message_id=message.id,
        chat_id=chat_id,
        creator_id=user_id,
        question=data.question,
        options=data.options,
        is_anonymous=data.is_anonymous,
        allow_retract=data.allow_retract,
        is_quiz=data.is_quiz,
        correct_option_index=data.correct_option_index,
    )
    response = MessageResponse(
        id=message.id,
        chat_id=chat_id,
        user_id=user_id,
        text=data.question,
        created_at=message.created_at,
        thread_root_id=data.thread_root_id,
        poll_id=poll.id,
    )
    # Refresh the computed poll_id for code sharing this transaction/session.
    await MessageDao.get_with_attachments(session, message.id)
    await RedisDao.invalidate_history(redis, chat_id)
    await RedisDao.publish_chat_event(
        redis,
        chat_id,
        json.dumps(
            {
                "event": "message:new",
                "data": response.model_dump(mode="json"),
            }
        ),
    )
    return response


async def vote_in_poll(
    session: AsyncSession,
    redis: Redis,
    poll_id: uuid.UUID,
    user_id: uuid.UUID,
    option_id: uuid.UUID | None,
) -> PollResponse:
    # The poll row serializes concurrent votes, including two first answers by one user.
    poll = await PollDao.get(session, poll_id, for_update=True)
    if poll is None:
        raise HTTPException(status_code=404, detail="Poll not found")
    await ensure_chat_member(session, poll.chat_id, user_id)
    if option_id is not None and not any(
        option.id == option_id for option in poll.options
    ):
        raise HTTPException(status_code=422, detail="Option does not belong to this poll")
    previous = next((vote for vote in poll.votes if vote.user_id == user_id), None)
    if previous is not None and previous.option_id == option_id:
        return poll_response(poll, user_id)
    if previous is not None and not poll.allow_retract:
        raise HTTPException(
            status_code=409,
            detail="This poll does not allow changing or retracting an answer",
        )
    if previous is None and option_id is None:
        return poll_response(poll, user_id)
    await PollDao.record_vote(session, poll_id, user_id, option_id)
    updated = await PollDao.get(session, poll_id)
    response = poll_response(updated, user_id)
    # No voter IDs, choices or quiz answers may be broadcast to the chat.
    await RedisDao.publish_chat_event(
        redis,
        poll.chat_id,
        json.dumps(
            {
                "event": "poll:updated",
                "data": {
                    "chat_id": str(poll.chat_id),
                    "poll_id": str(poll.id),
                    "message_id": str(poll.message_id),
                    "version": response.version,
                },
            }
        ),
    )
    return response


async def ensure_not_poll_edit(
    session: AsyncSession,
    message_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    message = await MessageDao.get_with_attachments(session, message_id)
    if message is not None and message.poll_id is not None:
        if message.user_id != user_id:
            raise HTTPException(status_code=404, detail="Message not found")
        raise HTTPException(
            status_code=422, detail="Polls cannot be edited after creation"
        )
