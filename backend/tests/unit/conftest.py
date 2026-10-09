import pytest_asyncio

from db.dao.chat_dao import ChatDao


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def chat_id(db_session, auth_token_and_user, id_second_user):
    users_in_chat_ids = [auth_token_and_user, id_second_user]

    new_chat = await ChatDao.add(
        db_session,
        {"owner_id": auth_token_and_user, "title": "pivo", "description": "pivo"},
    )

    await ChatDao.add_users_to_chat(
        session=db_session,
        chat_id=new_chat.id,
        new_user_ids=users_in_chat_ids,
    )
    await db_session.flush()
    yield str(new_chat.id)
