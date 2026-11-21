import uuid

from fastapi import status
from httpx2 import AsyncClient
import pytest
from sqlalchemy.ext.asyncio import AsyncSession
from unit.schemas import UserProfile

from core.security import get_password_hash
from db.models import Attachment

new_user = {
    "username": "ivan_natanich",
    "email": "alkash@mail.ru",
    "password": get_password_hash("Pivo228Chel"),
}


async def test_get_me(api_client: AsyncClient, auth_token_and_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.get("/api/v1/users/me", headers=headers)
    assert res.status_code == status.HTTP_200_OK
    assert UserProfile.model_validate(res.json())


async def test_update_me(api_client: AsyncClient, auth_token_and_user):
    headers = {"Authorization": f"Bearer {auth_token_and_user}"}
    res = await api_client.patch(
        "/api/v1/users/me",
        headers=headers,
        json={"username": "kto-to"},
    )
    assert res.status_code == status.HTTP_200_OK
    assert UserProfile.model_validate(res.json())


@pytest.mark.parametrize("method", ["GET", "PATCH"])
async def test_profile_keeps_valid_avatars_when_storage_key_is_missing(
    api_client: AsyncClient,
    auth_token_and_user: str,
    id_first_user: uuid.UUID,
    db_session: AsyncSession,
    minio_s3_storage: dict[str, str],
    method: str,
) -> None:
    db_session.add_all(
        [
            Attachment(
                user_id=id_first_user,
                file_key=file_key,
                file_name=name,
                file_size=12,
                mime_type="image/png",
                is_avatar=True,
            )
            for file_key, name in [
                (None, "legacy.png"),
                ("user_avatar/current.png", "current.png"),
            ]
        ]
    )
    await db_session.flush()

    response = await api_client.request(
        method,
        "/api/v1/users/me",
        headers={"Authorization": f"Bearer {auth_token_and_user}"},
        json={"username": "new-name"} if method == "PATCH" else None,
    )

    assert response.status_code == status.HTTP_200_OK
    profile = UserProfile.model_validate(response.json())
    assert profile.id == id_first_user
    (avatar_url,) = profile.avatar_urls
    assert avatar_url.startswith(f"{minio_s3_storage['endpoint']}/")
    assert "/user_avatar/current.png?" in avatar_url
