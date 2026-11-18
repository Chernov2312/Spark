from datetime import datetime, timezone
import json
from unittest.mock import AsyncMock
import uuid

from fastapi import status
import httpx
from httpx2 import AsyncClient
from openai import AsyncOpenAI
import pytest

from api.v1.ai import get_ai_service
from config.ai import AI
from core import ai_service
from core.ai_service import AIService
from db.dao.message_dao import MessageDao
from infrastructure.redis.message_queue import history_cache_key, history_version_key
from main import app
from schemas.message import MessageHistory, MessageResponse


@pytest.mark.parametrize(
    "base_url", ["https://provider.example", "https://provider.example/v1/"]
)
async def test_generate_text_uses_openai_settings(
    monkeypatch: pytest.MonkeyPatch, base_url: str
) -> None:
    monkeypatch.setenv("OPENAI_BASE_URL", base_url)
    monkeypatch.setenv("OPENAI_MODEL", "configured-model")
    monkeypatch.setenv("OPENAI_API_KEY", "test-api-key")
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://legacy-provider.example")
    monkeypatch.setenv("OLLAMA_MODEL", "legacy-model")
    monkeypatch.setattr(ai_service, "get_ai_settings", AI)

    def respond(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://provider.example/v1/chat/completions"
        assert request.headers["Authorization"] == "Bearer test-api-key"
        assert json.loads(request.content)["model"] == "configured-model"
        return httpx.Response(
            200,
            json={
                "id": "response-id",
                "object": "chat.completion",
                "created": 0,
                "model": "configured-model",
                "choices": [
                    {
                        "index": 0,
                        "finish_reason": "stop",
                        "message": {"role": "assistant", "content": "Ответ модели."},
                    }
                ],
            },
        )

    def create_client(*, base_url: str, api_key: str, timeout: float) -> AsyncOpenAI:
        return AsyncOpenAI(
            base_url=base_url,
            api_key=api_key,
            timeout=timeout,
            http_client=httpx.AsyncClient(transport=httpx.MockTransport(respond)),
        )

    monkeypatch.setattr(ai_service, "AsyncOpenAI", create_client)
    assert await AIService().generate_text("Тестовый запрос") == "Ответ модели."


def test_ai_settings_read_legacy_names(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("OPENAI_BASE_URL", "OPENAI_MODEL", "OPENAI_API_KEY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("OLLAMA_BASE_URL", "http://legacy-provider.example")
    monkeypatch.setenv("OLLAMA_MODEL", "legacy-model")

    settings = AI(_env_file=None)

    assert settings.OPENAI_BASE_URL == "http://legacy-provider.example"
    assert settings.OPENAI_MODEL == "legacy-model"
    assert settings.OPENAI_API_KEY.get_secret_value() == "ollama"


async def test_chat_assistant_answers_with_recent_chat_context(
    api_client: AsyncClient,
    auth_token_and_user,
    summarize_chat,
    monkeypatch,
):
    service = AIService()
    monkeypatch.setattr(
        service,
        "generate_text",
        AsyncMock(return_value="Обсудили план."),
    )
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
    service = AIService()
    monkeypatch.setattr(
        service,
        "generate_text",
        AsyncMock(return_value="Сводка чата."),
    )
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
    service = AIService()
    monkeypatch.setattr(
        service,
        "generate_text",
        AsyncMock(return_value="Ответ из кэша."),
    )
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
