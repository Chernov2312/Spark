from fastapi import status
from httpx2 import AsyncClient
from unit.schemas import AuthResponse


async def test_valid_register_user(api_client: AsyncClient, mock_email_task):
    test_user = {
        "username": "ivan_natanich",
        "email": "alkash@mail.ru",
        "password": "Pivo228Chel",
    }
    res = await api_client.post("api/v1/auth/register", json=test_user)
    assert res.status_code == status.HTTP_201_CREATED
    assert AuthResponse.model_validate(res.json())


async def test_invalid_username_register_user(api_client: AsyncClient):
    test_invalid_username = {
        "username": "iv",
        "email": "alert@mail.ru",
        "password": "Pivo228Chel",
    }
    res = await api_client.post("api/v1/auth/register", json=test_invalid_username)
    assert res.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


async def test_invalid_email_register_user(api_client: AsyncClient):
    test_invalid_email = {
        "username": "ivan",
        "email": "alertmail.ru",
        "password": "Pivo228Chel",
    }
    res = await api_client.post("api/v1/auth/register", json=test_invalid_email)
    assert res.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


async def test_invalid_password_register_user(api_client: AsyncClient):
    test_invalid_password = {
        "username": "iv",
        "email": "alert@mail.ru",
        "password": "pivo228chel",
    }
    res = await api_client.post("api/v1/auth/register", json=test_invalid_password)
    assert res.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT

    test_invalid_password = {
        "username": "iv",
        "email": "alert@mail.ru",
        "password": "PIVO228CHEL",
    }
    res = await api_client.post("api/v1/auth/register", json=test_invalid_password)
    assert res.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    test_invalid_password = {
        "username": "iv",
        "email": "alert@mail.ru",
        "password": "123456",
    }
    res = await api_client.post("api/v1/auth/register", json=test_invalid_password)
    assert res.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


async def invalid_test_login_user(api_client: AsyncClient):
    test_user = {
        "username": "ivan_natanich",
        "password": "Pivo228Chel",
        "email": "pochta@mail.ru",
    }
    res = await api_client.post("api/v1/auth/register", data=test_user)
    res = await api_client.post("api/v1/auth/login", data=test_user)
    assert res.status_code == status.HTTP_403_FORBIDDEN


async def test_login_user(api_client: AsyncClient, id_first_user):
    test_user = {
        "username": "ivan_natanich",
        "password": "Pivo228Chel",
    }
    res = await api_client.post("api/v1/auth/login", data=test_user)
    assert res.status_code == status.HTTP_200_OK
    assert res.json().get("id") == str(id_first_user)
    assert AuthResponse.model_validate(res.json())
