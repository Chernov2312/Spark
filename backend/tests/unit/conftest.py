import pytest_asyncio

from db.dao.chat_dao import ChatDao


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def chat_id(db_session, first_user_id, id_second_user):
    users_in_chat_ids = [first_user_id, id_second_user]

    new_chat = await ChatDao.add(
        db_session,
        {"owner_id": first_user_id, "title": "pivo", "description": "pivo"},
    )

    await ChatDao.add_users_to_chat(
        session=db_session,
        chat_id=new_chat.id,
        new_user_ids=users_in_chat_ids,
    )
    await db_session.flush()
    yield str(new_chat.id)
