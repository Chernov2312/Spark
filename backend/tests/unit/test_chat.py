from fastapi import status
from httpx import AsyncClient


async def test_get_me(api_client: AsyncClient, auth_token_and_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == status.HTTP_200_OK
