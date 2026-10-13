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


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def summarize_chat(db_session, id_first_user, id_second_user, chat_id):
    messages = [
        {"user_id": id_second_user, "text": "Привет! Посмотрел ТЗ по новому спринту."},
        {"user_id": id_first_user, "text": "Привет. И как тебе? Успеем до пятницы?"},
        {
            "user_id": id_second_user,
            "text": "Там много правок по дизайну, нужно обсудить голосом.",
        },
        {"user_id": id_second_user, "text": "Так созвон завтра в 21:10"},
        {"user_id": id_first_user, "text": "Ок, мне подходит. Запишу в календарь."},
        {"user_id": id_first_user, "text": "Кстати, у нас прод упал или мне кажется?"},
        {
            "user_id": id_second_user,
            "text": "Нет, там базу обновляют, через 10 минут поднимется.",
        },
        {"user_id": id_second_user, "text": "Коллеги почему не работаем"},
        {"user_id": id_second_user, "text": "На созвоне обсу"},
        {"user_id": id_first_user, "text": "Обсудим* ты хотел сказать?))"},
        {"user_id": id_second_user, "text": "Да, т9 забагался. Обсудим детали завтра."},
        {"user_id": id_first_user, "text": "Договорились. Я подготовлю список вопросов."},
        {"user_id": id_second_user, "text": "Супер, тогда до завтра!"},
    ]

    for msg in messages:
        await MessageDao.add(
            session=db_session,
            data={
                "chat_id": chat_id,
                "text": msg["text"],
                "user_id": msg["user_id"],
            },
        )

    await db_session.flush()
    yield chat_id
