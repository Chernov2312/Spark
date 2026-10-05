from httpx import AsyncClient
async def test_register_user(api_client: AsyncClient):
    test_user = {"username": "ivan_natanich", "email": "alkash@mail.ru", "password": "1234567890"}
    res = await api_client.post("/v1/auth/register", data=test_user)
    assert res.status_code == 