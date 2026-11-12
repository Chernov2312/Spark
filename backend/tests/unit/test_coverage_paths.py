import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, Response, WebSocketDisconnect
from jwt import InvalidTokenError

from api.v1 import auth as auth_api
from api.v1 import chats as chats_api
from api.v1 import media as media_api
from api.v1 import reactions as reactions_api
from api.v1 import user as user_api
from api.v1.websockets import chat_typing
from schemas.attachment import AttachmentRequest, AvatarUrlRequest
from schemas.chats import ChatAddUserRequest, NewChatRequest, PatchChatRequest
from schemas.reactions import ReactionsRequest
from schemas.user import Avatar, UserQuery, UserUpdate


def mock_s3(monkeypatch, *, temporary_url="https://signed.test/file", delete=True):
    storage = MagicMock()
    storage.create_file_key.side_effect = lambda file_extension, target_id, category: (
        f"{category}/{target_id}/file.{file_extension}"
    )
    storage.get_temporary_url = AsyncMock(return_value=temporary_url)
    storage.delete_file_by_key = AsyncMock(return_value=delete)
    monkeypatch.setattr(media_api, "S3Storage", MagicMock(return_value=storage))
    monkeypatch.setattr(user_api, "S3Storage", MagicMock(return_value=storage))
    monkeypatch.setattr(chats_api, "S3Storage", MagicMock(return_value=storage))
    return storage


@pytest.mark.parametrize(
    "file_type,content,expected_category,expect_chat_id",
    [
        ("message", "text/plain", "user_message", False),
        ("user_avatar", "image/png", "user_avatar", False),
        ("chat_avatar", "image/jpeg", "chat_avatar", True),
    ],
)
async def test_temporary_upload_urls_cover_supported_categories(
    monkeypatch,
    file_type,
    content,
    expected_category,
    expect_chat_id,
):
    storage = mock_s3(monkeypatch)
    user_id = uuid.uuid4()
    result = await media_api.get_temprorary_url_for_create_media(
        AvatarUrlRequest(
            type=file_type,
            file_extension="png",
            file_content=content,
            target_id=str(user_id),
        ),
        user_id=user_id,
    )

    assert result.temporary_url == "https://signed.test/file"
    assert result.file_key.startswith(f"{expected_category}/")
    assert (result.chat_id is not None) is expect_chat_id
    if not expect_chat_id:
        assert result.user_id == user_id
    storage.get_temporary_url.assert_awaited_once()


@pytest.mark.parametrize("file_type", ["user_avatar", "chat_avatar"])
async def test_temporary_avatar_url_rejects_non_image_content(monkeypatch, file_type):
    mock_s3(monkeypatch)
    with pytest.raises(HTTPException) as exc:
        await media_api.get_temprorary_url_for_create_media(
            AvatarUrlRequest(
                type=file_type,
                file_extension="txt",
                file_content="text/plain",
                target_id="ignored",
            ),
            user_id=uuid.uuid4(),
        )
    assert exc.value.status_code == 400


@pytest.mark.parametrize("chat_id", [None, uuid.uuid4()])
async def test_create_attachment_supports_user_and_chat_ownership(monkeypatch, chat_id):
    storage = mock_s3(monkeypatch)
    attachment_id = uuid.uuid4()
    user_id = uuid.uuid4()
    attachment = SimpleNamespace(
        id=attachment_id,
        file_key="user_message/file.txt",
        file_name="file.txt",
        file_size=4,
        mime_type="text/plain",
        text=None,
        user_id=user_id if chat_id is None else None,
        chat_id=chat_id,
    )
    add = AsyncMock(return_value=attachment)
    monkeypatch.setattr(media_api.AttachmentDao, "add", add)
    request = AttachmentRequest(
        chat_id=chat_id,
        file_key=attachment.file_key,
        file_name=attachment.file_name,
        file_size=attachment.file_size,
        mime_type=attachment.mime_type,
    )

    response = await media_api.create_attachment(
        request, session=object(), user_id=user_id
    )

    stored_data = add.await_args.kwargs["data"]
    if chat_id is None:
        assert stored_data["user_id"] == user_id
        assert "chat_id" not in stored_data
    else:
        assert stored_data["chat_id"] == chat_id
        assert "user_id" not in stored_data
    assert response.file_key == "https://signed.test/file"
    storage.get_temporary_url.assert_awaited_once()


async def test_auth_register_rejects_existing_username(monkeypatch):
    monkeypatch.setattr(
        auth_api.UserDao, "get_by_username_or_email", AsyncMock(return_value=object())
    )
    with pytest.raises(HTTPException) as exc:
        await auth_api.register(
            auth_api.UserRegister(
                username="taken", email="taken@example.com", password="Password123"
            ),
            session=object(),
        )
    assert exc.value.status_code == 409


async def test_auth_register_hashes_password_and_sends_verification(monkeypatch):
    user_id = uuid.uuid4()
    new_user = SimpleNamespace(id=user_id, username="new", email="new@example.com")
    add = AsyncMock(return_value=new_user)
    mail = MagicMock()
    monkeypatch.setattr(
        auth_api.UserDao, "get_by_username_or_email", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(auth_api.UserDao, "add", add)
    monkeypatch.setattr(auth_api, "get_password_hash", MagicMock(return_value="hashed"))
    monkeypatch.setattr(auth_api.send_mail_task, "delay", mail)

    response = await auth_api.register(
        auth_api.UserRegister(
            username="new", email="new@example.com", password="Password123"
        ),
        session=object(),
    )

    assert add.await_args.args[1]["password"] == "hashed"
    mail.assert_called_once_with(
        "new@example.com", "new", str(user_id), auth_api.settings.APP_BASE_URL
    )
    assert response.id == user_id


async def test_verification_marks_user_verified_and_returns_access_token(monkeypatch):
    user_id = uuid.uuid4()
    current_user = SimpleNamespace(is_verified=False)
    session = SimpleNamespace(commit=AsyncMock())
    monkeypatch.setattr(
        auth_api.jwt,
        "decode",
        MagicMock(
            return_value={
                "sub": "user@example.com",
                "username": "user",
                "user_id": str(user_id),
                "exp": 123,
            }
        ),
    )
    monkeypatch.setattr(
        auth_api.UserDao, "get_by_username_or_email", AsyncMock(return_value=current_user)
    )
    monkeypatch.setattr(auth_api, "create_access_token", MagicMock(return_value="access"))

    response = await auth_api.verification("valid-token", session)

    assert current_user.is_verified is True
    session.commit.assert_awaited_once()
    assert response.access_token == "access"


@pytest.mark.parametrize(
    "decode_result",
    [
        {"sub": "user@example.com", "username": "user"},
        InvalidTokenError("bad token"),
    ],
)
async def test_verification_rejects_missing_claims_and_bad_tokens(
    monkeypatch, decode_result
):
    if isinstance(decode_result, Exception):
        decode = MagicMock(side_effect=decode_result)
    else:
        decode = MagicMock(return_value=decode_result)
    monkeypatch.setattr(auth_api.jwt, "decode", decode)
    with pytest.raises(HTTPException) as exc:
        await auth_api.verification("invalid-token", object())
    assert exc.value.status_code == 401


async def test_login_rejects_bad_credentials_and_unverified_user(monkeypatch):
    form = SimpleNamespace(username="user", password="ValidPassword123")
    monkeypatch.setattr(auth_api, "authenticate_user", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await auth_api.login_for_access_token(form, object())
    assert exc.value.status_code == 401

    unverified = SimpleNamespace(is_verified=False)
    monkeypatch.setattr(auth_api, "authenticate_user", AsyncMock(return_value=unverified))
    with pytest.raises(HTTPException) as exc:
        await auth_api.login_for_access_token(form, object())
    assert exc.value.status_code == 403


async def test_user_get_me_signs_avatar_urls(monkeypatch):
    user_id = uuid.uuid4()
    created_at = datetime.now(timezone.utc)
    user = SimpleNamespace(
        id=user_id,
        username="user",
        email="user@example.com",
        created_at=created_at,
        avatars=[SimpleNamespace(file_key="avatar/key")],
    )
    monkeypatch.setattr(
        user_api.UserDao, "get_user_with_avatars", AsyncMock(return_value=user)
    )
    storage = mock_s3(monkeypatch)

    response = await user_api.get_me(session=object(), user_id=user_id)

    assert response.avatar_urls == ["https://signed.test/file"]
    storage.get_temporary_url.assert_awaited_once_with(
        file_key="avatar/key", client_method="get_object"
    )


async def test_user_update_not_found_rolls_back_avatar_delete_and_search(monkeypatch):
    user_id = uuid.uuid4()
    monkeypatch.setattr(user_api.UserDao, "update_by_id", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await user_api.update_me(
            UserUpdate(username="missing"), session=object(), current_user_id=user_id
        )
    assert exc.value.status_code == 404

    monkeypatch.setattr(
        user_api.AttachmentDao,
        "delete_attachment_by_url_and_user_id",
        AsyncMock(return_value=object()),
    )
    session = SimpleNamespace(rollback=AsyncMock())
    mock_s3(monkeypatch, delete=False)
    with pytest.raises(HTTPException) as exc:
        await user_api.delete_avatar(
            Avatar(url="avatar/key"), session=session, current_user_id=user_id
        )
    assert exc.value.status_code == 504
    session.rollback.assert_awaited_once()

    monkeypatch.setattr(user_api.UserDao, "find_by_username", AsyncMock(return_value=[]))
    response = await user_api.get_user_by_username(
        UserQuery(username="search"), user_id, object()
    )
    assert response.users == []


async def test_user_delete_avatar_missing_and_success(monkeypatch):
    user_id = uuid.uuid4()
    session = SimpleNamespace(rollback=AsyncMock())
    delete_attachment = AsyncMock(return_value=None)
    monkeypatch.setattr(
        user_api.AttachmentDao, "delete_attachment_by_url_and_user_id", delete_attachment
    )
    with pytest.raises(HTTPException) as exc:
        await user_api.delete_avatar(
            Avatar(url="missing"), session=session, current_user_id=user_id
        )
    assert exc.value.status_code == 404

    delete_attachment.return_value = object()
    mock_s3(monkeypatch, delete=True)
    response = await user_api.delete_avatar(
        Avatar(url="avatar/key"), session=session, current_user_id=user_id
    )
    assert isinstance(response, Response)
    assert response.status_code == 204


async def test_reaction_routes_cover_add_change_remove_and_missing_reaction(monkeypatch):
    message_id, user_id, chat_id = uuid.uuid4(), uuid.uuid4(), str(uuid.uuid4())
    redis = AsyncMock()
    redis.get.side_effect = [None, chat_id, "🔥", chat_id, "🔥", chat_id, None, chat_id]
    pipe = MagicMock()
    pipe.__aenter__.return_value = pipe
    pipe.execute = AsyncMock(return_value=[None, None, {}, None])
    redis.pipeline = MagicMock(return_value=pipe)
    redis.hgetall = AsyncMock(return_value={})
    invalidate = AsyncMock()
    monkeypatch.setattr(reactions_api, "invalidate_chat_history", invalidate)
    session = object()

    await reactions_api.post_reactions(
        message_id, ReactionsRequest(emoji="🔥"), user_id, redis, session
    )
    await reactions_api.post_reactions(
        message_id, ReactionsRequest(emoji="❤️"), user_id, redis, session
    )
    await reactions_api.delete(message_id, user_id, redis, session)
    await reactions_api.delete(message_id, user_id, redis, session)

    assert pipe.hincrby.call_count == 4
    assert invalidate.await_count == 3
    assert redis.hgetall.await_count == 1


async def test_reaction_route_falls_back_to_database_for_chat_id(monkeypatch):
    message_id, user_id, chat_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    redis = AsyncMock()
    redis.get.side_effect = [None, None]
    pipe = MagicMock()
    pipe.__aenter__.return_value = pipe
    pipe.execute = AsyncMock(return_value=[None, None, {}, None])
    redis.pipeline = MagicMock(return_value=pipe)
    lookup = AsyncMock(return_value=chat_id)
    invalidate = AsyncMock()
    monkeypatch.setattr(reactions_api.MessageDao, "get_chat_id_by_message", lookup)
    monkeypatch.setattr(reactions_api, "invalidate_chat_history", invalidate)

    await reactions_api.post_reactions(
        message_id, ReactionsRequest(emoji="🔥"), user_id, redis, object()
    )

    lookup.assert_awaited_once()
    invalidate.assert_awaited_once_with(redis, chat_id)


async def test_chat_routes_cover_empty_avatar_lists_permissions_and_missing_chat(
    monkeypatch,
):
    user_id, chat_id = uuid.uuid4(), uuid.uuid4()
    user = SimpleNamespace(chats=[])
    monkeypatch.setattr(
        chats_api.UserDao, "get_user_with_chats", AsyncMock(return_value=user)
    )
    await chats_api.get_chats(session=object(), user_id=user_id)

    missing_lookup = AsyncMock(return_value=None)
    monkeypatch.setattr(chats_api.ChatDao, "get_chat_with_users", missing_lookup)
    with pytest.raises(HTTPException) as exc:
        await chats_api.update_chat(
            str(chat_id),
            PatchChatRequest(title="x", description="y"),
            object(),
            str(user_id),
        )
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await chats_api.add_users_in_chat(
            ChatAddUserRequest(user_ids=[]), str(chat_id), object(), str(user_id)
        )
    assert exc.value.status_code == 404

    chat = SimpleNamespace(owner_id=str(uuid.uuid4()), id=chat_id, users=[])
    monkeypatch.setattr(
        chats_api.ChatDao, "get_chat_with_users", AsyncMock(return_value=chat)
    )
    with pytest.raises(HTTPException) as exc:
        await chats_api.update_chat(
            str(chat_id),
            PatchChatRequest(title="x", description="y"),
            object(),
            str(user_id),
        )
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await chats_api.add_users_in_chat(
            ChatAddUserRequest(user_ids=[]), str(chat_id), object(), str(user_id)
        )
    assert exc.value.status_code == 403


async def test_chat_route_rejects_missing_invites_and_updates_members(monkeypatch):
    user_id, chat_id = uuid.uuid4(), uuid.uuid4()
    missing_user_ids = AsyncMock(return_value=[uuid.uuid4()])
    monkeypatch.setattr(chats_api.ChatDao, "get_missing_user_ids", missing_user_ids)
    request = NewChatRequest(title="chat", description="", invited_user_ids=[])
    with pytest.raises(HTTPException) as exc:
        await chats_api.post_new_chat(request, object(), user_id)
    assert exc.value.status_code == 404

    created_at = datetime.now(timezone.utc)
    chat = SimpleNamespace(
        owner_id=str(user_id),
        id=chat_id,
        title="chat",
        description="",
        created_at=created_at,
    )
    monkeypatch.setattr(
        chats_api.ChatDao, "get_missing_user_ids", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(chats_api.ChatDao, "add", AsyncMock(return_value=chat))
    monkeypatch.setattr(chats_api.ChatDao, "add_users_to_chat", AsyncMock())
    monkeypatch.setattr(chats_api, "S3Storage", MagicMock())
    response = await chats_api.post_new_chat(request, object(), user_id)
    assert response.id == chat_id

    existing_chat = SimpleNamespace(
        id=chat_id,
        owner_id=str(user_id),
        description="old",
        title="old",
        created_at=created_at,
        updated_at=created_at,
    )
    monkeypatch.setattr(
        chats_api.ChatDao, "get_chat_with_users", AsyncMock(return_value=existing_chat)
    )
    updated = await chats_api.update_chat(
        str(chat_id),
        PatchChatRequest(title="new", description="changed"),
        object(),
        str(user_id),
    )
    assert updated.title == "new"
    assert updated.description == "changed"

    session = SimpleNamespace(commit=AsyncMock(), refresh=AsyncMock())
    monkeypatch.setattr(
        chats_api.ChatDao, "get_missing_user_ids", AsyncMock(return_value=[])
    )
    added = await chats_api.add_users_in_chat(
        ChatAddUserRequest(user_ids=[uuid.uuid4()]), str(chat_id), session, str(user_id)
    )
    assert added.status == "success"
    session.commit.assert_awaited_once()


async def test_typing_websocket_closes_when_token_is_invalid(monkeypatch):
    chat_id = uuid.uuid4()
    redis = AsyncMock()
    websocket = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(redis=redis)),
        accept=AsyncMock(),
        close=AsyncMock(),
    )
    auth = AsyncMock(side_effect=Exception("bad token"))
    monkeypatch.setattr(chat_typing, "get_id_current_user", auth)
    await chat_typing.on_message(websocket, chat_id, "token")
    websocket.accept.assert_awaited_once()
    websocket.close.assert_awaited_once()


async def test_typing_websocket_publishes_events_and_cleans_up(monkeypatch):
    user_id, chat_id, message_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    redis = AsyncMock()
    websocket = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(redis=redis)),
        accept=AsyncMock(),
        close=AsyncMock(),
        receive_json=AsyncMock(
            side_effect=[
                {
                    "event": "message:new",
                    "data": {
                        "id": str(message_id),
                        "text": "hello",
                        "chat_id": str(chat_id),
                        "user_id": str(user_id),
                    },
                },
                {"event": "user:typing", "data": {"chat_id": str(chat_id)}},
                WebSocketDisconnect(),
            ],
        ),
    )
    manager = SimpleNamespace(add=AsyncMock(), remove=AsyncMock())
    listener = AsyncMock()
    monkeypatch.setattr(
        chat_typing, "get_id_current_user", AsyncMock(return_value=user_id)
    )
    monkeypatch.setattr(chat_typing, "local_manager", manager)
    monkeypatch.setattr(chat_typing, "redis_pubsub_listener", listener)

    await chat_typing.on_message(websocket, chat_id, "token")

    assert redis.publish.await_count == 2
    assert '"event":"user:typing"' in redis.publish.await_args_list[1].args[1]
    assert str(user_id) in redis.publish.await_args_list[1].args[1]
    redis.srem.assert_awaited_once_with(f"chat:{chat_id}:users", str(user_id))
    manager.remove.assert_awaited_once_with(user_id)
