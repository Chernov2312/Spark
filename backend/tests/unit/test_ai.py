import uuid

from fastapi import status
from httpx import AsyncClient


async def test_rewrite(api_client: AsyncClient, auth_token_and_user: uuid.UUID):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    data = {
        "text": "Дарова парни, каково состояние проекта.",
        "mode": "professional",
    }
    res = await api_client.post(
        url="/api/v1/ai/messages/rewrite", headers=headers, json=data,
    )
    assert res.status_code == status.HTTP_200_OK


async def test_summarize(api_client: AsyncClient, auth_token_and_user: uuid.UUID, summarize_chat):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.post(
        url=f"/api/v1/ai/chats/{summarize_chat}/summarize", headers=headers,
    )
    assert res.status_code == status.HTTP_200_OK
