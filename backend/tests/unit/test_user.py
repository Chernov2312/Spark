from fastapi import status
from httpx import AsyncClient

from core.security import get_password_hash

new_user = {
    "username": "ivan_natanich",
    "email": "alkash@mail.ru",
    "password": get_password_hash("Pivo228Chel"),
}


async def test_get_me(api_client: AsyncClient, auth_token_and_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == status.HTTP_200_OK
    assert res.json().get("username") == new_user.get("username")


async def test_update_me(api_client: AsyncClient, auth_token_and_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.patch(
        "/api/v1/users/me", headers=headers, json={"username": "kto-to"},
    )
    assert res.status_code == status.HTTP_200_OK
    print(res.json())
    assert res.json().get("username") == "kto-to"
