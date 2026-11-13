from types import SimpleNamespace
from unittest.mock import AsyncMock

from fastapi import status
from httpx2 import AsyncClient
from main import app

from api.v1.ai import get_ai_service


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
