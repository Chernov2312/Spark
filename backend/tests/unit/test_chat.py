from fastapi import status
from httpx import AsyncClient
from unit.schemas import ChatModel, GetChats, NewChatResponse

from core.security import get_password_hash
from db.dao.user_dao import UserDao


async def test_create_chat(api_client: AsyncClient, auth_token_and_user, id_second_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.post(
        "/api/v1/chats",
        headers=headers,
        json={
            "title": "uhfewt",
            "description": "ergpjiergh",
            "invited_user_ids": [str(id_second_user)],
        },
    )
    assert res.status_code == status.HTTP_201_CREATED
    assert NewChatResponse.model_validate(res.json())


async def test_get_chats(api_client: AsyncClient, auth_token_and_user, chat_id):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.get(
        "/api/v1/chats",
        headers=headers,
    )
    assert res.status_code == status.HTTP_200_OK
    assert GetChats.model_validate(res.json())


async def test_update_chat(api_client: AsyncClient, auth_token_and_user, chat_id):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.patch(
        f"/api/v1/chats/{chat_id}",
        headers=headers,
        json={"title": "pivo", "description": "New description"},
    )
    assert res.status_code == status.HTTP_200_OK
    assert ChatModel.model_validate(res.json())


# async def test_update_avatar_chat(
#     api_client: AsyncClient, auth_token_and_user, chat_id: uuid.UUID
# ):
#     headers = {"Authorization": f"Bearer {auth_token_and_user}"}
#     with open("tests/fixtures/cat.jpg", "rb") as f:
#         files = {
#             "avatar": ("cat.jpg", f, "image/jpeg"),
#         }
#         res = await api_client.get(
#             f"/api/v1/chats/{chat_id}/avatar",
#             headers=headers,
#             files=files,
#         )
#         assert res.status_code == status.HTTP_200_OK


async def test_add_users_in_chat(
    db_session,
    api_client: AsyncClient,
    auth_token_and_user,
    chat_id,
):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    new_user = {
        "username": "pivozavrik_nih_natanich",
        "email": "alkash_pivo_228@mail.ru",
        "password": get_password_hash("Pivo228Chel"),
    }
    user = await UserDao.add(session=db_session, data=new_user)
    await db_session.flush()
    res = await api_client.post(
        f"/api/v1/chats/{chat_id}/users",
        headers=headers,
        json={"user_ids": [str(user.id)]},
    )
    assert res.status_code == status.HTTP_200_OK
