async def test_start_app(api_client):
    response = await api_client.get("/docs")

    assert response.status_code == 200
