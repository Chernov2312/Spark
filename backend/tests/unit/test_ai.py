import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import status
from httpx2 import AsyncClient
from main import app

from api.v1.ai import get_ai_service
from core.message_queue import history_cache_key, history_version_key
from db.dao.message_dao import MessageDao
from schemas.message import MessageHistory, MessageResponse


async def test_chat_assistant_answers_with_recent_chat_context(
    api_client: AsyncClient,
    auth_token_and_user,
    summarize_chat,
    monkeypatch,
):
    service = SimpleNamespace(generate_text=AsyncMock(return_value="Обсудили план."))
    monkeypatch.setitem(app.dependency_overrides, get_ai_service, lambda: service)
    question = "О чём договорились?"

    response = await api_client.post(
        f"/api/v1/ai/chats/{summarize_chat}/assistant",
        headers={"Authorization": f"Bearer {auth_token_and_user}"},
        json={"question": question, "limit": 12},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == {"answer": "Обсудили план.", "context_messages": 12}
    prompt = service.generate_text.await_args.kwargs["prompt"]
    assert question in prompt
    assert "Участник" in prompt
    assert service.generate_text.await_args.kwargs["system_instruction"]


async def test_chat_summary_uses_limited_recent_context(
    api_client: AsyncClient,
    auth_token_and_user,
    summarize_chat,
    monkeypatch,
):
    service = SimpleNamespace(generate_text=AsyncMock(return_value="Сводка чата."))
    monkeypatch.setitem(app.dependency_overrides, get_ai_service, lambda: service)

    response = await api_client.post(
        f"/api/v1/ai/chats/{summarize_chat}/summarize?limit=5",
        headers={"Authorization": f"Bearer {auth_token_and_user}"},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["summary"] == "Сводка чата."
    assert response.json()["chat_id"] == str(summarize_chat)
    assert service.generate_text.await_args.kwargs["system_instruction"]


async def test_chat_assistant_skips_database_history_when_redis_has_enough(
    api_client: AsyncClient,
    auth_token_and_user,
    id_first_user,
    summarize_chat,
    monkeypatch,
):
    redis = app.state.redis
    version = int(await redis.get(history_version_key(summarize_chat)) or 0)
    cached_messages = [
        MessageResponse(
            id=uuid.uuid4(),
            chat_id=summarize_chat,
            user_id=id_first_user,
            text=f"cached message {index}",
            attachments=[],
            reactions_count={},
            created_at=datetime.now(timezone.utc),
        )
        for index in range(5, 0, -1)
    ]
    await redis.set(
        history_cache_key(summarize_chat, id_first_user, 50, None, version),
        MessageHistory(messages=cached_messages).model_dump_json(),
    )
    service = SimpleNamespace(generate_text=AsyncMock(return_value="Ответ из кэша."))
    monkeypatch.setitem(app.dependency_overrides, get_ai_service, lambda: service)
    history_query = AsyncMock(
        side_effect=AssertionError("history should come from Redis"),
    )
    monkeypatch.setattr(MessageDao, "get_chat_history", history_query)

    response = await api_client.post(
        f"/api/v1/ai/chats/{summarize_chat}/assistant",
        headers={"Authorization": f"Bearer {auth_token_and_user}"},
        json={"question": "Что обсуждали?", "limit": 3},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["context_messages"] == 3
    prompt = service.generate_text.await_args.kwargs["prompt"]
    assert "cached message 5" in prompt
    assert "cached message 3" in prompt
    assert "cached message 2" not in prompt
    history_query.assert_not_awaited()


async def test_rewrite_uses_containerized_ollama(
    ai_api_client: AsyncClient,
    auth_token_and_user,
):
    text = "Please move our meeting to tomorrow at ten."
    response = await ai_api_client.post(
        "/api/v1/ai/messages/rewrite",
        headers={"Authorization": f"Bearer {auth_token_and_user}"},
        json={"text": text, "mode": "friendly"},
    )

    assert response.status_code == status.HTTP_200_OK
    result = response.json()
    assert result["original_text"] == text
    assert result["modified_text"].strip()
