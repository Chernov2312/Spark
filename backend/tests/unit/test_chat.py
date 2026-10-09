from fastapi import status
from httpx import AsyncClient


async def test_get_me(api_client: AsyncClient, auth_token_and_user, id_second_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.post("/api/v1/chats", headers=headers, json={"title":"uhfewt", "description":"ergpjiergh", "invited_user_ids":[id_second_user]})
    assert res.status_code == status.HTTP_201_CREATED
