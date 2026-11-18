from datetime import datetime, timedelta
import uuid

from httpx2 import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from core.security import create_access_token
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from db.models import Chat, User
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.websockets import WsEvent


def authorization(user_id: uuid.UUID) -> dict[str, str]:
    return {"Authorization": f"Bearer {create_access_token({'sub': str(user_id)})}"}


async def test_pinned_messages_include_old_messages_attachments_and_thread_replies(
    db_session: AsyncSession,
    db_user: User,
    db_userchat: tuple[Chat, User],
    minio_s3_storage: dict[str, str],
    api_client: AsyncClient,
) -> None:
    chat, member = db_userchat
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    old = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": db_user.id,
            "text": None,
            "created_at": datetime(2026, 1, 1),
        },
        [
            {
                "chat_id": chat.id,
                "file_key": "uploads/pin.png",
                "file_name": "pin.png",
                "file_size": 3,
                "mime_type": "image/png",
            }
        ],
    )
    reply = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": member.id,
            "text": "Pinned thread reply",
            "thread_root_id": old.id,
        },
        [],
    )
    for index in range(55):
        await MessageDao.create_with_attachments(
            db_session,
            {
                "chat_id": chat.id,
                "user_id": member.id,
                "text": f"Later {index}",
                "created_at": datetime(2026, 1, 2) + timedelta(minutes=index),
            },
            [],
        )
    await MessageDao.toggle_pin(db_session, chat.id, old.id, member.id)
    await MessageDao.toggle_pin(db_session, chat.id, reply.id, member.id)
    assert old.id not in {
        row.id
        for row in await MessageDao.get_chat_history(db_session, chat.id, member.id)
    }
    dao_pins = await MessageDao.get_pinned_messages(db_session, chat.id)
    assert {row.id for row in dao_pins} == {old.id, reply.id}
    assert await MessageDao.get_pinned_messages(db_session, uuid.uuid4()) == []
    response = await api_client.get(
        f"/api/v1/chats/{chat.id}/messages/pinned", headers=authorization(member.id)
    )
    assert response.status_code == 200
    pins = {item["id"]: item for item in response.json()["messages"]}
    assert set(pins) == {str(old.id), str(reply.id)}
    assert all(item["is_pinned"] for item in pins.values())
    assert pins[str(old.id)]["attachments"][0]["file_name"] == "pin.png"
    assert pins[str(old.id)]["attachments"][0]["file_key"].startswith("http")
    assert pins[str(reply.id)]["thread_root_id"] == str(old.id)
    assert pins[str(old.id)]["thread_reply_count"] == 1
    forbidden = await api_client.get(
        f"/api/v1/chats/{chat.id}/messages/pinned", headers=authorization(uuid.uuid4())
    )
    assert forbidden.status_code == 403
    missing = await api_client.get(
        f"/api/v1/chats/{uuid.uuid4()}/messages/pinned", headers=authorization(member.id)
    )
    assert missing.status_code == 404


async def test_pin_events_history_search_threads_edits_and_unpin_agree(
    db_session: AsyncSession,
    db_user: User,
    db_userchat: tuple[Chat, User],
    api_client: AsyncClient,
    test_redis_client: Redis,
) -> None:
    chat, member = db_userchat
    await ChatDao.add_users_to_chat(db_session, chat.id, [db_user.id])
    root = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": member.id,
            "text": "Important root",
            "reactions_count": {"👍": 2},
        },
        [],
    )
    reply = await MessageDao.create_with_attachments(
        db_session,
        {
            "chat_id": chat.id,
            "user_id": member.id,
            "text": "Important reply",
            "thread_root_id": root.id,
        },
        [],
    )
    headers = authorization(member.id)
    base = f"/api/v1/chats/{chat.id}/messages"
    # Prime the history cache before changing the pin state.
    await api_client.get(base, headers=headers)
    version = await RedisDao.get_history_version(test_redis_client, chat.id)
    async with test_redis_client.pubsub() as subscriber:
        await subscriber.subscribe(f"chat:{chat.id}")
        await subscriber.get_message(timeout=1)
        for message in [root, reply]:
            changed = await api_client.put(f"{base}/{message.id}/pin", headers=headers)
            assert changed.json() == {"pinned": True}
            event = await subscriber.get_message(
                ignore_subscribe_messages=True, timeout=2
            )
            parsed = WsEvent.model_validate_json(event["data"])
            assert parsed.event == "message:updated"
            assert parsed.data.id == message.id
            assert parsed.data.is_pinned is True
            if message.id == root.id:
                assert parsed.data.reactions_count == {"👍": 2}
                assert parsed.data.thread_reply_count == 1
    assert await RedisDao.get_history_version(test_redis_client, chat.id) > version
    for endpoint in [base, f"{base}/search?text=Important", f"{base}/{root.id}/thread"]:
        response = await api_client.get(endpoint, headers=headers)
        assert response.status_code == 200
        assert all(message["is_pinned"] for message in response.json()["messages"])
    edited = await api_client.put(
        f"/api/v1/messages/{root.id}", headers=headers, json={"text": "Updated pin"}
    )
    assert edited.status_code == 200
    assert edited.json()["is_pinned"] is True
    unpinned = await api_client.put(f"{base}/{root.id}/pin", headers=headers)
    assert unpinned.json() == {"pinned": False}
    history = await api_client.get(base, headers=headers)
    assert (
        next(
            message
            for message in history.json()["messages"]
            if message["id"] == str(root.id)
        )["is_pinned"]
        is False
    )
    await api_client.delete(f"/api/v1/messages/{root.id}", headers=headers)
    remaining = await api_client.get(f"{base}/pinned", headers=headers)
    assert remaining.json() == {"messages": []}
