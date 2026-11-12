from datetime import timedelta

import pytest
from fastapi import HTTPException

from core.security import (
    create_access_token,
    get_id_current_user,
    get_password_hash,
    verify_password,
)


def test_password_hash_verifies_only_the_original_password():
    hashed_password = get_password_hash("correct-horse-battery")

    assert hashed_password != "correct-horse-battery"
    assert verify_password("correct-horse-battery", hashed_password)
    assert not verify_password("wrong-password", hashed_password)


@pytest.mark.asyncio
async def test_access_token_returns_its_user_id():
    user_id = "6d2b8c5a-c8a3-44a3-93e4-7301f33eeadd"
    token = create_access_token({"sub": user_id})

    assert str(await get_id_current_user(token)) == user_id


@pytest.mark.asyncio
async def test_expired_access_token_is_rejected():
    token = create_access_token(
        {"sub": "6d2b8c5a-c8a3-44a3-93e4-7301f33eeadd"},
        timedelta(seconds=-1),
    )

    with pytest.raises(HTTPException) as error:
        await get_id_current_user(token)

    assert error.value.status_code == 401
