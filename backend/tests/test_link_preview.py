from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
import ipaddress
from unittest.mock import AsyncMock, Mock
import uuid

from fastapi import HTTPException
import httpx
from kombu.exceptions import OperationalError
import pytest
from tasks import link_preview as preview_tasks

from core import link_preview
from core.message_actions import validate_message_preview_url
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import LinkPreview
from schemas.websockets import MessageLinkPreview, WsEvent


@pytest.mark.parametrize(
    ("text", "url"),
    [
        ("Ссылка https://example.com", None),
        ("**www.example.com**", "https://www.example.com"),
        ("[Documentation](https://example.com/?a=1&b=2)", "https://example.com/?a=1&b=2"),
        (
            "https://first.example.com https://second.example.com",
            "https://second.example.com",
        ),
    ],
)
def test_validate_client_selected_url(text: str, url: str | None) -> None:
    validate_message_preview_url(text, url)


@pytest.mark.parametrize(
    ("text", "url"),
    [
        ("https://example.com", "https://other.example.com"),
        ("ftp://example.com", "ftp://example.com"),
        ("http://example.com:8080/", "http://example.com:8080/"),
        ("https://user:password@example.com/", "https://user:password@example.com/"),
        (None, "https://example.com"),
    ],
)
def test_reject_invalid_client_selected_url(text: str | None, url: str) -> None:
    with pytest.raises(HTTPException) as raised:
        validate_message_preview_url(text, url)
    assert raised.value.status_code == 422


def mock_http_transport(
    monkeypatch: pytest.MonkeyPatch,
    responder: Callable[[httpx.Request], httpx.Response],
) -> None:
    monkeypatch.setattr(
        link_preview.httpx,
        "AsyncHTTPTransport",
        lambda **_kwargs: httpx.MockTransport(responder),
    )


async def test_fetch_preview_uses_resolved_address_and_parses_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def resolve(host: str, port: int) -> list[ipaddress.IPv4Address]:
        assert (host, port) == ("example.com", 443)
        return [ipaddress.IPv4Address("8.8.8.8")]

    def respond(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://8.8.8.8/page?x=1"
        assert request.headers["host"] == "example.com"
        assert request.extensions["sni_hostname"] == "example.com"
        return httpx.Response(
            200,
            headers={"content-type": "text/html; charset=utf-8"},
            stream=httpx.ByteStream(
                b'<title>Fallback</title><meta property="og:title" content="A &amp; B">'
                b'<meta name="description" content="Short  description">'
            ),
        )

    monkeypatch.setattr(link_preview, "_resolve_public_addresses", resolve)
    mock_http_transport(monkeypatch, respond)
    preview = await link_preview.fetch_link_preview("https://example.com/page?x=1#intro")
    assert preview is not None
    assert preview.model_dump() == {
        "url": "https://example.com/page?x=1#intro",
        "title": "A & B",
        "description": "Short description",
    }


async def test_fetch_preview_revalidates_redirects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    resolve_public = link_preview._resolve_public_addresses

    async def resolve(
        host: str, port: int
    ) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
        if host == "example.com":
            return [ipaddress.IPv4Address("8.8.8.8")]
        return await resolve_public(host, port)

    responder = Mock(
        return_value=httpx.Response(302, headers={"location": "http://127.0.0.1/"})
    )
    monkeypatch.setattr(link_preview, "_resolve_public_addresses", resolve)
    mock_http_transport(monkeypatch, responder)

    assert await link_preview.fetch_link_preview("https://example.com/") is None
    assert await link_preview.fetch_link_preview("http://127.0.0.1/") is None
    responder.assert_called_once()


async def test_enqueue_explicit_url_and_allow_broker_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    submit = Mock(side_effect=OperationalError("offline"))
    monkeypatch.setattr(preview_tasks.parse_link_preview_task, "apply_async", submit)
    chat_id, message_id = uuid.uuid4(), uuid.uuid4()
    await preview_tasks.enqueue_link_preview(chat_id, message_id, None)
    submit.assert_not_called()

    await preview_tasks.enqueue_link_preview(
        chat_id, message_id, "https://www.example.com"
    )
    assert submit.call_args.kwargs["args"] == (
        str(chat_id),
        str(message_id),
        "https://www.example.com",
    )


async def test_task_caches_preview_and_publishes_websocket_event(
    monkeypatch: pytest.MonkeyPatch,
    test_redis_client: Redis,
) -> None:
    @asynccontextmanager
    async def redis_context() -> AsyncIterator[Redis]:
        yield test_redis_client

    chat_id, message_id = uuid.uuid4(), uuid.uuid4()
    preview = LinkPreview(url="https://example.com/", title="Example")
    fetch = AsyncMock(return_value=preview)
    monkeypatch.setattr(preview_tasks, "fetch_link_preview", fetch)
    monkeypatch.setattr(preview_tasks, "get_redis", redis_context)

    channel = f"chat:{chat_id}"
    async with test_redis_client.pubsub() as subscription:
        await subscription.subscribe(channel)
        await subscription.get_message(timeout=1)
        await preview_tasks.publish_link_preview(chat_id, message_id, preview.url)
        message = await subscription.get_message(
            ignore_subscribe_messages=True, timeout=1
        )
        assert message is not None
        event = WsEvent.model_validate_json(message["data"])
        assert event.event == "message:link-preview"
        assert event.data == MessageLinkPreview(
            chat_id=chat_id, message_id=message_id, preview=preview
        )

    assert (
        await RedisDao.get_link_preview(
            test_redis_client, chat_id, message_id, preview.url
        )
        == preview
    )
    assert await RedisDao.get_history_version(test_redis_client, chat_id) == 1
    await preview_tasks.publish_link_preview(chat_id, message_id, preview.url)
    fetch.assert_awaited_once_with(preview.url)
