from fastapi import status
from httpx2 import AsyncClient


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
