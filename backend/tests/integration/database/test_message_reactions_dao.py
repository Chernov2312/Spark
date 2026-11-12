import uuid

from db.dao.message_dao import MessageDao
from db.dao.message_reactions_dao import MessageReactionDao


async def test_reaction_dao_reads_and_updates_user_reactions(
    db_session,
    db_user,
    db_userchat,
):
    chat, another_user = db_userchat
    first_message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "first"},
        [],
    )
    second_message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat.id, "user_id": db_user.id, "text": "second"},
        [],
    )
    first_reaction = await MessageReactionDao.add(
        db_session,
        {
            "user_id": another_user.id,
            "message_id": first_message.id,
            "emoji": "👍",
        },
    )
    await MessageReactionDao.add(
        db_session,
        {
            "user_id": another_user.id,
            "message_id": second_message.id,
            "emoji": "❤️",
        },
    )

    result = await MessageReactionDao.get_user_reactions(
        db_session,
        another_user.id,
        [first_message.id],
    )
    await MessageReactionDao.update_user_reactions(
        db_session,
        [
            {
                "id": str(first_message.id),
                "users": {str(another_user.id): "🔥"},
                "reactions_count": {},
            },
        ],
    )
    await MessageDao.update_msg_reactions_by_ids(
        db_session,
        [{"id": first_message.id, "reactions_count": {"🔥": 1}}],
    )

    await db_session.refresh(first_reaction)
    await db_session.refresh(first_message)
    assert [reaction.id for reaction in result] == [first_reaction.id]
    assert first_reaction.emoji == "🔥"
    assert first_message.reactions_count == {"🔥": 1}
    assert (
        await MessageReactionDao.get_user_reactions(
            db_session,
            uuid.uuid4(),
            [first_message.id, second_message.id],
        )
        == []
    )


async def test_reaction_updates_accept_empty_batch(db_session):
    assert await MessageReactionDao.update_user_reactions(db_session, []) is None
    assert await MessageDao.update_msg_reactions_by_ids(db_session, []) is None
