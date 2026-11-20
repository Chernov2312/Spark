from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from unittest.mock import Mock
import uuid

from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from generate_web_push_keys import encode
from httpx2 import AsyncClient
from pydantic import SecretStr, ValidationError
import pytest
from requests import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from tasks import push as push_tasks

from api.v1 import push as push_api
from config import get_settings
from core.security import create_access_token
from db.models import Chat, PushSubscription, user_chat
from schemas.push import PushEndpoint, PushSubscriptionRequest


def subscription(name: str) -> PushSubscriptionRequest:
    public_key = ec.generate_private_key(ec.SECP256R1()).public_key()
    return PushSubscriptionRequest(
        endpoint=f"https://fcm.googleapis.com/fcm/send/{name}",
        keys={
            "p256dh": encode(
                public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
            ),
            "auth": encode(b"test-auth-secret"),
        },
    )


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://fcm.googleapis.com/fcm/send/device",
        "https://localhost/device",
        "https://fcm.googleapis.com.example.org/fcm/send/device",
        "https://fcm.googleapis.com:444/fcm/send/device",
        "https://fcm.googleapis.com/other-api/device",
    ],
)
def test_push_rejects_unsupported_endpoints(endpoint: str) -> None:
    with pytest.raises(ValidationError):
        PushEndpoint(endpoint=endpoint)


def push_settings() -> dict[str, object]:
    key = ec.generate_private_key(ec.SECP256R1())
    return {
        "WEB_PUSH_SUBJECT": "mailto:operator@example.org",
        "WEB_PUSH_PUBLIC_KEY": encode(
            key.public_key().public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        ),
        "WEB_PUSH_PRIVATE_KEY": SecretStr(
            encode(key.private_numbers().private_value.to_bytes(32, "big"))
        ),
    }


def test_worker_encrypts_payload_and_recognizes_expired_subscription(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request = subscription("expired")
    device = PushSubscription(
        id=uuid.uuid4(),
        endpoint=request.endpoint,
        p256dh=request.keys.p256dh,
        auth_secret=request.keys.auth,
    )
    settings = get_settings().model_copy(update=push_settings())
    monkeypatch.setattr(push_tasks, "get_settings", lambda: settings)
    response = Response()
    response.status_code = 410
    response._content = b""
    post = Mock(return_value=response)
    monkeypatch.setattr(push_tasks.requests.Session, "post", post)
    chat_id, message_id = uuid.uuid4(), uuid.uuid4()

    assert push_tasks.send_to_browser(device, chat_id, message_id, silent=False)
    assert post.call_args.args == (device.endpoint,)
    assert post.call_args.kwargs["allow_redirects"] is False
    headers = post.call_args.kwargs["headers"]
    assert headers["Authorization"].startswith("vapid ")
    assert headers["Content-Encoding"] == "aes128gcm"
    assert str(chat_id).encode() not in post.call_args.kwargs["data"]


async def test_push_uses_membership_and_per_device_settings(
    api_client: AsyncClient,
    db_session: AsyncSession,
    id_first_user: uuid.UUID,
    id_second_user: uuid.UUID,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings().model_copy(update=push_settings())
    monkeypatch.setattr(push_api, "get_settings", lambda: settings)
    monkeypatch.setattr(push_tasks, "get_settings", lambda: settings)
    chat = Chat(title="Push test", description="", owner_id=id_first_user)
    db_session.add(chat)
    await db_session.flush()
    await db_session.execute(
        user_chat.insert(),
        [
            {"chat_id": chat.id, "user_id": user}
            for user in (id_first_user, id_second_user)
        ],
    )

    def headers(user_id: uuid.UUID) -> dict[str, str]:
        token = create_access_token({"sub": str(user_id)})
        return {"Authorization": f"Bearer {token}"}

    assert (await api_client.get("/api/v1/push/config")).status_code == 401
    response = await api_client.get("/api/v1/push/config", headers=headers(id_first_user))
    assert response.json() == {"public_key": settings.WEB_PUSH_PUBLIC_KEY}

    for user_id, name, chat_options in (
        (id_first_user, "sender", {}),
        (id_second_user, "muted", {str(chat.id): {"muted": True}}),
        (id_second_user, "notify", {str(chat.id): {"silent": True}}),
    ):
        data = subscription(name).model_dump(mode="json")
        data["chat_options"] = chat_options
        response = await api_client.put(
            "/api/v1/push/subscription", headers=headers(user_id), json=data
        )
        assert response.status_code == 204

    @asynccontextmanager
    async def session() -> AsyncIterator[AsyncSession]:
        yield db_session

    # The worker reads and deletes through the same isolated transaction as the fixture.
    class SessionFactory:
        def __call__(self) -> AbstractAsyncContextManager[AsyncSession]:
            return session()

        def begin(self) -> AbstractAsyncContextManager[AsyncSession]:
            return session()

    monkeypatch.setattr(push_tasks, "async_session_maker", SessionFactory())
    send = Mock(return_value=True)
    monkeypatch.setattr(push_tasks, "send_to_browser", send)
    submit = Mock()
    monkeypatch.setattr(push_tasks.push_message_task, "apply_async", submit)
    response = await api_client.post(
        f"/api/v1/chats/{chat.id}/messages",
        headers=headers(id_first_user),
        json={"text": "A message"},
    )
    assert response.status_code == 201
    message_id = uuid.UUID(response.json()["id"])
    submit.assert_called_once()
    assert submit.call_args.kwargs["args"] == (
        str(chat.id),
        str(id_first_user),
        str(message_id),
    )
    await push_tasks.deliver_message_push(chat.id, id_first_user, message_id)
    send.assert_called_once()
    device, actual_chat, actual_message, silent = send.call_args.args
    assert device.endpoint.endswith("/notify")
    assert (actual_chat, actual_message, silent) == (chat.id, message_id, True)
    stored = await db_session.scalars(select(PushSubscription.endpoint))
    assert {endpoint.rsplit("/", 1)[-1] for endpoint in stored} == {"sender", "muted"}

    endpoint = "https://fcm.googleapis.com/fcm/send/muted"
    response = await api_client.request(
        "DELETE",
        "/api/v1/push/subscription",
        headers=headers(id_second_user),
        json={"endpoint": endpoint},
    )
    assert response.status_code == 204
    stored = await db_session.scalars(select(PushSubscription.endpoint))
    assert list(stored) == ["https://fcm.googleapis.com/fcm/send/sender"]
