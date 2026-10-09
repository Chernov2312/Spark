from fastapi import status
from httpx import AsyncClient

from core.security import get_password_hash

new_user = {
    "username": "ivan_natanich",
    "email": "alkash@mail.ru",
    "password": get_password_hash("Pivo228Chel"),
}


async def test_create_chat(api_client: AsyncClient, auth_token_and_user, id_second_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.post("/api/v1/chats", headers=headers, json={"title":"choto", "description": "owhggoboerg", "invited_user_ids": [str(id_second_user)]})
    assert res.status_code == status.HTTP_201_CREATED
