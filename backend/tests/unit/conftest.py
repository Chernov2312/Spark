import os
from types import SimpleNamespace

import pytest
import pytest_asyncio
from testcontainers.ollama import OllamaContainer

from api.v1.ai import get_ai_service
from core.ai_service import AIService
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from main import app


@pytest_asyncio.fixture(autouse=True, scope="function", loop_scope="session")
async def testcontainer_services(db_engine, test_redis_client):
    """Run every unit test with the shared PostgreSQL and Redis test containers."""
    yield


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


OLLAMA_MODEL = "qwen3:0.6b"


class CpuOllamaContainer(OllamaContainer):
    """Run Ollama without requesting a GPU in CPU-only CI environments."""

    def _check_and_add_gpu_capabilities(self):
        pass


@pytest.fixture(scope="session")
def ollama_container():
    external_url = os.getenv("OLLAMA_TEST_BASE_URL")
    if external_url:
        yield SimpleNamespace(get_endpoint=lambda: external_url.rstrip("/"))
        return

    with CpuOllamaContainer(image="ollama/ollama:0.34.2") as container:
        container.pull_model(OLLAMA_MODEL)
        yield container


@pytest_asyncio.fixture(scope="function", loop_scope="session")
async def ai_api_client(api_client, ollama_container):
    app.dependency_overrides[get_ai_service] = lambda: AIService(
        model_name=OLLAMA_MODEL,
        ollama_base_url=ollama_container.get_endpoint(),
    )
    yield api_client
    app.dependency_overrides.pop(get_ai_service, None)
