import pytest_asyncio

from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def chat_id(db_session, id_first_user, id_second_user):
    users_in_chat_ids = [id_first_user, id_second_user]

    new_chat = await ChatDao.add(
        db_session,
        {"owner_id": id_first_user, "title": "pivo", "description": "pivo"},
    )

    await ChatDao.add_users_to_chat(
        session=db_session,
        chat_id=new_chat.id,
        new_user_ids=users_in_chat_ids,
    )
    await db_session.flush()
    yield new_chat.id


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def spam_history(db_session, id_first_user, id_second_user, chat_id):
    import random

    for i in range(100):
        await MessageDao.add(
            session=db_session,
            data={
                "chat_id": chat_id,
                "text": str(i),
                "user_id": random.choice([id_first_user, id_second_user]),
            },
        )
    await db_session.flush()
    yield chat_id
