import uuid

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from db.models.poll import Poll, PollOption, PollVote


class PollDao:
    @classmethod
    async def create(
        cls,
        session: AsyncSession,
        *,
        message_id: uuid.UUID,
        chat_id: uuid.UUID,
        creator_id: uuid.UUID,
        question: str,
        options: list[str],
        is_anonymous: bool,
        allow_retract: bool,
        is_quiz: bool,
        correct_option_index: int | None,
    ) -> Poll:
        poll = Poll(
            id=uuid.uuid4(),
            message_id=message_id,
            chat_id=chat_id,
            creator_id=creator_id,
            question=question,
            is_anonymous=is_anonymous,
            allow_retract=allow_retract,
            is_quiz=is_quiz,
            correct_option_index=correct_option_index,
            votes=[],
            options=[
                PollOption(id=uuid.uuid4(), text=text, position=index)
                for index, text in enumerate(options)
            ],
        )
        session.add(poll)
        await session.flush()
        return poll

    @classmethod
    async def get(
        cls,
        session: AsyncSession,
        poll_id: uuid.UUID,
        *,
        for_update: bool = False,
    ) -> Poll | None:
        query = select(Poll).where(Poll.id == poll_id)
        if for_update:
            query = query.with_for_update()
        return await session.scalar(
            query.options(
                selectinload(Poll.options),
                selectinload(Poll.votes).selectinload(PollVote.user),
            ).execution_options(populate_existing=True)
        )

    @classmethod
    async def record_vote(
        cls,
        session: AsyncSession,
        poll_id: uuid.UUID,
        user_id: uuid.UUID,
        option_id: uuid.UUID | None,
    ) -> None:
        vote = await session.scalar(
            select(PollVote).where(
                PollVote.poll_id == poll_id,
                PollVote.user_id == user_id,
            )
        )
        if option_id is None:
            await session.execute(
                delete(PollVote).where(
                    PollVote.poll_id == poll_id, PollVote.user_id == user_id
                )
            )
        elif vote is None:
            session.add(PollVote(poll_id=poll_id, user_id=user_id, option_id=option_id))
        else:
            vote.option_id = option_id
        await session.execute(
            update(Poll).where(Poll.id == poll_id).values(version=Poll.version + 1)
        )
        await session.flush()
