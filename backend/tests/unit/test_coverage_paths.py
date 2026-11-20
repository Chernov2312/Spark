import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
import uuid

from fastapi import HTTPException, Response, WebSocketDisconnect
from jwt import InvalidTokenError
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from api.v1 import auth as auth_api
from api.v1 import chats as chats_api
from api.v1 import media as media_api
from api.v1 import reactions as reactions_api
from api.v1 import user as user_api
from api.v1.websockets import chat_typing
from core.storage import S3Storage
from db.dao.message_dao import MessageDao
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
    monkeypatch.setattr(user_api, "S3Storage", MagicMock(return_value=storage))
    monkeypatch.setattr(chats_api, "S3Storage", MagicMock(return_value=storage))
    return storage


def test_temporary_file_keys_are_unique_for_repeated_uploads():
    storage = S3Storage.__new__(S3Storage)
    target_id = uuid.uuid4()

    first_key = storage.create_file_key("webp", target_id, "user_message")
    second_key = storage.create_file_key("webp", target_id, "user_message")

    assert first_key != second_key
    assert first_key.startswith(f"user_message/{target_id}/")
    assert first_key.endswith(".webp")


@pytest.mark.parametrize(
    "file_type,content,expected_category,expect_chat_id",
    [
        ("message", "text/plain", "user_message", False),
        ("user_avatar", "image/png", "user_avatar", False),
        ("chat_avatar", "image/jpeg", "chat_avatar", True),
    ],
)
async def test_temporary_upload_urls_cover_supported_categories(
    monkeypatch: pytest.MonkeyPatch,
    db_session: AsyncSession,
    chat_id: uuid.UUID,
    id_first_user: uuid.UUID,
    file_type: str,
    content: str,
    expected_category: str,
    expect_chat_id: bool,
) -> None:
    storage = mock_s3(monkeypatch)
    user_id = id_first_user if expect_chat_id else uuid.uuid4()
    result = await media_api.get_temprorary_url_for_create_media(
        AvatarUrlRequest(
            type=file_type,
            file_extension="png",
            file_content=content,
            target_id=str(chat_id if expect_chat_id else user_id),
        ),
        user_id=user_id,
        session=db_session,
    )

    assert result.temporary_url == "https://signed.test/file"
    assert result.file_key.startswith(f"{expected_category}/")
    assert (result.chat_id is not None) is expect_chat_id
    if expect_chat_id:
        assert result.chat_id == chat_id
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
async def test_create_attachment_supports_user_and_chat_ownership(
    monkeypatch,
    db_session,
    chat_id,
):
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
        request,
        session=db_session,
        user_id=user_id,
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


async def test_download_attachment_signs_filename_for_chat_member(
    monkeypatch,
    db_session,
    chat_id,
    id_second_user,
):
    storage = mock_s3(monkeypatch)
    attachment = await media_api.AttachmentDao.add(
        db_session,
        {
            "chat_id": chat_id,
            "file_key": "user_message/photo.jpg",
            "file_name": "летний отпуск.jpg",
            "file_size": 12,
            "mime_type": "image/jpeg",
            "is_avatar": False,
        },
    )

    response = await media_api.download_attachment(
        attachment.id,
        session=db_session,
        user_id=id_second_user,
    )

    assert response.url == "https://signed.test/file"
    storage.get_temporary_url.assert_awaited_once()
    call = storage.get_temporary_url.await_args
    assert call.args == (attachment.file_key,)
    disposition = call.kwargs["response_content_disposition"]
    fallback = 'attachment; filename="' + "_" * 13 + '.jpg";'
    assert disposition.startswith(fallback)
    assert "filename*=UTF-8''%D0%BB%D0%B5%D1%82%D0%BD%D0%B8%D0%B9%20" in disposition
    assert "%D0%BE%D1%82%D0%BF%D1%83%D1%81%D0%BA.jpg" in disposition


async def test_download_attachment_hides_chat_file_from_non_member(
    monkeypatch,
    db_session,
    chat_id,
):
    mock_s3(monkeypatch)
    attachment = await media_api.AttachmentDao.add(
        db_session,
        {
            "chat_id": chat_id,
            "file_key": "user_message/photo.jpg",
            "file_name": "photo.jpg",
            "file_size": 12,
            "mime_type": "image/jpeg",
            "is_avatar": False,
        },
    )

    with pytest.raises(HTTPException) as exc:
        await media_api.download_attachment(
            attachment.id,
            session=db_session,
            user_id=uuid.uuid4(),
        )

    assert exc.value.status_code == 404


async def test_auth_register_rejects_existing_username(monkeypatch, db_session):
    monkeypatch.setattr(
        auth_api.UserDao,
        "get_by_username_or_email",
        AsyncMock(return_value=object()),
    )
    with pytest.raises(HTTPException) as exc:
        await auth_api.register(
            auth_api.UserRegister(
                username="taken",
                email="taken@example.com",
                password="Password123",
            ),
            session=db_session,
        )
    assert exc.value.status_code == 409


async def test_auth_register_hashes_password_and_sends_verification(
    monkeypatch,
    db_session,
):
    mail = MagicMock()
    monkeypatch.setattr(auth_api, "get_password_hash", MagicMock(return_value="hashed"))
    monkeypatch.setattr(auth_api.send_mail_task, "delay", mail)

    response = await auth_api.register(
        auth_api.UserRegister(
            username="new",
            email="new@example.com",
            password="Password123",
        ),
        session=db_session,
    )

    new_user = await auth_api.UserDao.get_by_id(db_session, response.id)
    assert new_user.password == "hashed"
    mail.assert_called_once_with(
        "new@example.com",
        "new",
        str(response.id),
        auth_api.get_settings().FRONTEND_BASE_URL,
    )
    categories = await auth_api.SocialDao.list_friend_categories(
        db_session,
        response.id,
    )
    folders = await auth_api.SocialDao.list_chat_folders(db_session, response.id)
    assert len(categories) == 3
    assert len(folders) == 3


async def test_verification_marks_user_verified_and_returns_access_token(
    monkeypatch,
    db_session,
):
    current_user = await auth_api.UserDao.add(
        db_session,
        {
            "username": "verification-user",
            "tag": "verification-user",
            "email": "verification-user@example.com",
            "password": "hashed",
            "is_verified": False,
        },
    )
    monkeypatch.setattr(
        auth_api.jwt,
        "decode",
        MagicMock(
            return_value={
                "sub": current_user.email,
                "username": "user",
                "user_id": str(current_user.id),
                "exp": 123,
            },
        ),
    )
    monkeypatch.setattr(auth_api, "create_access_token", MagicMock(return_value="access"))

    response = await auth_api.verification("valid-token", db_session)

    assert current_user.is_verified is True
    assert response.access_token == "access"


@pytest.mark.parametrize(
    "decode_result",
    [
        {"sub": "user@example.com", "username": "user"},
        InvalidTokenError("bad token"),
    ],
)
async def test_verification_rejects_missing_claims_and_bad_tokens(
    monkeypatch,
    db_session,
    decode_result,
):
    if isinstance(decode_result, Exception):
        decode = MagicMock(side_effect=decode_result)
    else:
        decode = MagicMock(return_value=decode_result)
    monkeypatch.setattr(auth_api.jwt, "decode", decode)
    with pytest.raises(HTTPException) as exc:
        await auth_api.verification("invalid-token", db_session)
    assert exc.value.status_code == 401


async def test_login_rejects_bad_credentials_and_unverified_user(
    monkeypatch,
    db_session,
):
    form = SimpleNamespace(username="user", password="ValidPassword123")
    monkeypatch.setattr(auth_api, "authenticate_user", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await auth_api.login_for_access_token(form, db_session)
    assert exc.value.status_code == 401

    unverified = SimpleNamespace(is_verified=False)
    monkeypatch.setattr(auth_api, "authenticate_user", AsyncMock(return_value=unverified))
    with pytest.raises(HTTPException) as exc:
        await auth_api.login_for_access_token(form, db_session)
    assert exc.value.status_code == 403


async def test_user_get_me_signs_avatar_urls(monkeypatch, db_session, id_first_user):
    user_id = id_first_user
    await media_api.AttachmentDao.add(
        db_session,
        {
            "user_id": user_id,
            "file_key": "avatar/key",
            "file_name": "avatar.png",
            "file_size": 12,
            "mime_type": "image/png",
            "is_avatar": True,
        },
    )
    storage = mock_s3(monkeypatch)

    response = await user_api.get_me(session=db_session, user_id=user_id)

    assert response.avatar_urls == ["https://signed.test/file"]
    storage.get_temporary_url.assert_awaited_once_with(
        file_key="avatar/key",
        client_method="get_object",
    )


async def test_user_update_not_found_rolls_back_avatar_delete_and_search(
    monkeypatch,
    db_session,
    id_first_user,
):
    user_id = uuid.uuid4()
    monkeypatch.setattr(user_api.UserDao, "update_by_id", AsyncMock(return_value=None))
    with pytest.raises(HTTPException) as exc:
        await user_api.update_me(
            UserUpdate(username="missing"),
            session=db_session,
            current_user_id=user_id,
        )
    assert exc.value.status_code == 404

    image = await media_api.AttachmentDao.add(
        db_session,
        {
            "user_id": id_first_user,
            "file_key": "avatar/key",
            "file_name": "avatar.png",
            "file_size": 12,
            "mime_type": "image/png",
            "is_avatar": True,
        },
    )
    mock_s3(monkeypatch, delete=False)
    with pytest.raises(HTTPException) as exc:
        await user_api.delete_avatar(
            Avatar(url="avatar/key"),
            session=db_session,
            current_user_id=id_first_user,
        )
    assert exc.value.status_code == 504
    assert await user_api.AttachmentDao.get_by_id(db_session, image.id) is not None

    response = await user_api.get_user_by_username(
        UserQuery(username="search"),
        id_first_user,
        db_session,
    )
    assert response.users == []


async def test_user_delete_avatar_missing_and_success(
    monkeypatch,
    db_session,
    id_first_user,
):
    user_id = id_first_user
    with pytest.raises(HTTPException) as exc:
        await user_api.delete_avatar(
            Avatar(url="missing"),
            session=db_session,
            current_user_id=user_id,
        )
    assert exc.value.status_code == 404

    image = await user_api.AttachmentDao.add(
        db_session,
        {
            "user_id": user_id,
            "file_key": "avatar/key",
            "file_name": "avatar.png",
            "file_size": 12,
            "mime_type": "image/png",
            "is_avatar": True,
        },
    )
    mock_s3(monkeypatch, delete=True)
    response = await user_api.delete_avatar(
        Avatar(url="avatar/key"),
        session=db_session,
        current_user_id=user_id,
    )
    assert isinstance(response, Response)
    assert response.status_code == 204
    assert await user_api.AttachmentDao.get_by_id(db_session, image.id) is None


async def test_reaction_routes_cover_add_change_remove_and_missing_reaction(
    db_session,
    test_redis_client,
):
    message_id, user_id, chat_id = uuid.uuid4(), uuid.uuid4(), str(uuid.uuid4())
    redis = test_redis_client
    await redis.set(f"message:chat:{message_id}", chat_id)

    await reactions_api.post_reactions(
        message_id,
        ReactionsRequest(emoji="🔥"),
        user_id,
        redis,
        db_session,
    )
    assert await redis.hget(f"message:reactions_count:{message_id}", "🔥") == "1"
    await reactions_api.post_reactions(
        message_id,
        ReactionsRequest(emoji="❤️"),
        user_id,
        redis,
        db_session,
    )
    assert await redis.hget(f"message:reactions_count:{message_id}", "🔥") == "0"
    assert await redis.hget(f"message:reactions_count:{message_id}", "❤️") == "1"
    await reactions_api.delete(message_id, user_id, redis, db_session)
    await reactions_api.delete(message_id, user_id, redis, db_session)

    assert await redis.get(f"message:user_reaction:{message_id}:{user_id}") is None
    assert await redis.smembers(f"message:users:{message_id}") == set()
    assert await redis.get(f"messages:history-version:{chat_id}") == "3"


async def test_reaction_route_falls_back_to_database_for_chat_id(
    db_session,
    test_redis_client,
    chat_id,
    id_first_user,
):
    user_id = id_first_user
    redis = test_redis_client
    message = await MessageDao.create_with_attachments(
        db_session,
        {"chat_id": chat_id, "user_id": id_first_user, "text": "reaction target"},
        [],
    )

    await reactions_api.post_reactions(
        message.id,
        ReactionsRequest(emoji="🔥"),
        user_id,
        redis,
        db_session,
    )

    assert await redis.get(f"message:chat:{message.id}") is None
    assert await redis.get(f"messages:history-version:{chat_id}") == "1"


async def test_chat_routes_cover_empty_avatar_lists_permissions_and_missing_chat(
    monkeypatch,
    db_session,
):
    user_id, chat_id = uuid.uuid4(), uuid.uuid4()
    user = SimpleNamespace(chats=[])
    monkeypatch.setattr(
        chats_api.UserDao,
        "get_user_with_chats",
        AsyncMock(return_value=user),
    )
    await chats_api.get_chats(session=db_session, user_id=user_id)

    missing_lookup = AsyncMock(return_value=None)
    monkeypatch.setattr(chats_api.ChatDao, "get_chat_with_users", missing_lookup)
    with pytest.raises(HTTPException) as exc:
        await chats_api.update_chat(
            str(chat_id),
            PatchChatRequest(title="x", description="y"),
            db_session,
            str(user_id),
        )
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        await chats_api.add_users_in_chat(
            ChatAddUserRequest(user_ids=[]),
            str(chat_id),
            db_session,
            str(user_id),
        )
    assert exc.value.status_code == 404

    chat = SimpleNamespace(owner_id=str(uuid.uuid4()), id=chat_id, users=[])
    monkeypatch.setattr(
        chats_api.ChatDao,
        "get_chat_with_users",
        AsyncMock(return_value=chat),
    )
    with pytest.raises(HTTPException) as exc:
        await chats_api.update_chat(
            str(chat_id),
            PatchChatRequest(title="x", description="y"),
            db_session,
            str(user_id),
        )
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await chats_api.add_users_in_chat(
            ChatAddUserRequest(user_ids=[]),
            str(chat_id),
            db_session,
            str(user_id),
        )
    assert exc.value.status_code == 403


async def test_chat_route_rejects_missing_invites_and_updates_members(
    db_session,
    id_first_user,
    id_second_user,
):
    owner_id = id_first_user
    request_with_missing_invite = NewChatRequest(
        title="chat with missing invite",
        description="",
        invited_user_ids=[uuid.uuid4()],
    )
    with pytest.raises(HTTPException) as exc:
        await chats_api.post_new_chat(
            request_with_missing_invite,
            db_session,
            owner_id,
        )
    assert exc.value.status_code == 404

    request = NewChatRequest(
        title="container-created-chat",
        description="original description",
        invited_user_ids=[id_second_user],
    )
    created = await chats_api.post_new_chat(request, db_session, owner_id)
    assert created.title == request.title

    updated = await chats_api.update_chat(
        created.id,
        PatchChatRequest(title="renamed-container-chat", description="changed"),
        db_session,
        owner_id,
    )
    assert updated.title == "renamed-container-chat"
    assert updated.description == "changed"

    third_user = await chats_api.UserDao.add(
        db_session,
        {
            "username": "third-chat-user",
            "email": "third-chat-user@example.com",
            "password": "hashed",
        },
    )
    added = await chats_api.add_users_in_chat(
        ChatAddUserRequest(user_ids=[third_user.id]),
        created.id,
        db_session,
        owner_id,
    )
    assert added.status == "success"
    updated_chat = await chats_api.ChatDao.get_chat_with_users(db_session, created.id)
    assert third_user.id in {user.id for user in updated_chat.users}


async def test_typing_websocket_closes_when_token_is_invalid(
    monkeypatch,
    test_redis_client,
):
    chat_id = uuid.uuid4()
    redis = test_redis_client
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


async def test_typing_websocket_publishes_events_and_cleans_up(
    monkeypatch,
    test_redis_client,
):
    user_id, chat_id, message_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    redis = test_redis_client
    pubsub = redis.pubsub()
    await pubsub.subscribe(f"chat:{chat_id}")

    received = []
    incoming_events = [
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
    ]

    async def receive_json():
        if not incoming_events:
            raise WebSocketDisconnect()
        await asyncio.sleep(0.05)
        return incoming_events.pop(0)

    websocket = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(redis=redis)),
        accept=AsyncMock(),
        close=AsyncMock(),
        receive_json=receive_json,
        send_text=AsyncMock(side_effect=received.append),
    )
    manager = SimpleNamespace(add=AsyncMock(), remove=AsyncMock())
    monkeypatch.setattr(
        chat_typing,
        "get_id_current_user",
        AsyncMock(return_value=user_id),
    )
    monkeypatch.setattr(chat_typing, "local_manager", manager)
    await chat_typing.on_message(websocket, chat_id, "token", False)

    published_events = []
    while len(published_events) < 2:
        item = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1)
        if item and item["type"] == "message":
            published_events.append(item["data"])
    assert '"event":"message:new"' in published_events[0]
    assert '"is_forwarded":false' in published_events[0]
    assert '"event":"user:typing"' in published_events[1]
    assert str(user_id) in published_events[1]
    assert await redis.smembers(f"chat:{chat_id}:users") == set()
    assert any('"event":"user:typing"' in payload for payload in received)
    manager.remove.assert_awaited_once_with(user_id)
    await pubsub.aclose()
