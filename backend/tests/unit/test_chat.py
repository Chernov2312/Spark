import uuid

from fastapi import status
from httpx2 import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession
from unit.schemas import ChatModel, GetChats, NewChatResponse

from core.security import create_access_token, get_password_hash
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
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


async def test_create_chat_rejects_missing_invited_user_before_insert(
    db_session,
    api_client: AsyncClient,
    auth_token_and_user,
):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    chats_before = await ChatDao.get_all(db_session)

    response = await api_client.post(
        "/api/v1/chats",
        headers=headers,
        json={
            "title": "Invalid invite",
            "description": "Must not be created",
            "invited_user_ids": [str(uuid.uuid4())],
        },
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert len(await ChatDao.get_all(db_session)) == len(chats_before)


async def test_get_chats(api_client: AsyncClient, auth_token_and_user, chat_id):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.get(
        "/api/v1/chats",
        headers=headers,
    )
    assert res.status_code == status.HTTP_200_OK
    assert GetChats.model_validate(res.json())


async def test_open_direct_chat_creates_and_reuses_dialog_for_both_members(
    api_client: AsyncClient,
    db_session: AsyncSession,
    auth_token_and_user: str,
    id_first_user: uuid.UUID,
    id_second_user: uuid.UUID,
) -> None:
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    peer = await UserDao.get_by_id(db_session, id_second_user)
    owner = await UserDao.get_by_id(db_session, id_first_user)
    path = f"/api/v1/users/{id_second_user}/direct-chat"

    created = await api_client.post(path, headers=headers)
    assert created.status_code == 200
    dialog = created.json()
    assert dialog["title"] == peer.username
    assert dialog["users_count"] == 2

    repeated = await api_client.post(path, headers=headers)
    assert repeated.status_code == 200
    assert repeated.json()["id"] == dialog["id"]

    peer_token = create_access_token({"sub": str(id_second_user)})
    peer_headers = {"Authorization": f"Bearer {peer_token}"}
    reversed_dialog = await api_client.post(
        f"/api/v1/users/{id_first_user}/direct-chat",
        headers=peer_headers,
    )
    assert reversed_dialog.status_code == 200
    assert reversed_dialog.json()["id"] == dialog["id"]
    assert reversed_dialog.json()["title"] == owner.username

    listed = await api_client.get("/api/v1/chats", headers=headers)
    assert listed.status_code == 200
    (listed_dialog,) = listed.json()["chats"]
    assert listed_dialog["id"] == dialog["id"]
    assert listed_dialog["title"] == peer.username

    left = await api_client.delete(
        f"/api/v1/chats/{dialog['id']}/members/me", headers=peer_headers
    )
    assert left.status_code == 204
    db_session.expire_all()
    listed = await api_client.get("/api/v1/chats", headers=headers)
    assert listed.status_code == 200
    (listed_dialog,) = listed.json()["chats"]
    assert listed_dialog["id"] == dialog["id"]
    assert listed_dialog["users_count"] == 1


async def test_add_users_rejects_missing_user(
    api_client: AsyncClient,
    auth_token_and_user,
    chat_id,
):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    response = await api_client.post(
        f"/api/v1/chats/{chat_id}/users",
        headers=headers,
        json={"user_ids": [str(uuid.uuid4())]},
    )

    assert response.status_code == status.HTTP_404_NOT_FOUND


async def test_update_chat(api_client: AsyncClient, auth_token_and_user, chat_id):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.patch(
        f"/api/v1/chats/{chat_id}",
        headers=headers,
        json={"title": "pivo", "description": "New description"},
    )
    assert res.status_code == status.HTTP_200_OK
    assert ChatModel.model_validate(res.json())


async def test_chat_owner_can_delete_chat_and_its_messages(
    db_session: AsyncSession,
    api_client: AsyncClient,
    auth_token_and_user: str,
    id_first_user: uuid.UUID,
    chat_id: uuid.UUID,
) -> None:
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    message = await MessageDao.add(
        db_session,
        {"chat_id": chat_id, "user_id": id_first_user, "text": "delete with chat"},
    )

    response = await api_client.delete(f"/api/v1/chats/{chat_id}", headers=headers)

    assert response.status_code == status.HTTP_204_NO_CONTENT
    assert await ChatDao.get_by_id(db_session, chat_id) is None
    assert await MessageDao.get_by_id(db_session, message.id) is None


async def test_member_can_leave_chat_but_owner_cannot(
    db_session: AsyncSession,
    api_client: AsyncClient,
    auth_token_and_user: str,
    id_first_user: uuid.UUID,
    id_second_user: uuid.UUID,
    chat_id: uuid.UUID,
) -> None:
    member_token = create_access_token({"sub": str(id_second_user)})
    member_headers = {"Authorization": f"Bearer {member_token}"}
    delete_response = await api_client.delete(
        f"/api/v1/chats/{chat_id}",
        headers=member_headers,
    )
    assert delete_response.status_code == status.HTTP_403_FORBIDDEN

    owner_headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    owner_response = await api_client.delete(
        f"/api/v1/chats/{chat_id}/members/me",
        headers=owner_headers,
    )
    assert owner_response.status_code == status.HTTP_409_CONFLICT

    member_response = await api_client.delete(
        f"/api/v1/chats/{chat_id}/members/me",
        headers=member_headers,
    )

    assert member_response.status_code == status.HTTP_204_NO_CONTENT
    assert set(await ChatDao.get_member_roles(db_session, chat_id)) == {id_first_user}


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
