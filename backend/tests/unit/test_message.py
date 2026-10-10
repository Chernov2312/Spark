import uuid

from fastapi import status
from httpx import AsyncClient


async def test_get_chat_history(
    spam_history: uuid.UUID,
    api_client: AsyncClient,
    auth_token_and_user,
):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.get(
        url=f"/api/v1/chats/{spam_history}/messages",
        headers=headers,
    )
    assert res.status_code == status.HTTP_200_OK
