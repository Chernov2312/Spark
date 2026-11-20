import asyncio
from contextlib import suppress
import uuid

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from core.dependencies import local_manager
from core.security import get_id_current_user
from infrastructure.redis.client import Redis
from infrastructure.redis.pubsub import redis_pubsub_listener
from infrastructure.redis.redis_dao import RedisDao
from schemas.websockets import WsEvent

ws_router = APIRouter()


@ws_router.websocket("/{chat_id}/ws")
async def on_message(
    websocket: WebSocket,
    chat_id: uuid.UUID,
    token: str = Query(),
    share_presence: bool = Query(default=True),
) -> None:
    await websocket.accept()
    redis: Redis = websocket.app.state.redis
    try:
        user_id = await get_id_current_user(token)
    except Exception:
        await websocket.close()
        return
    await RedisDao.add_chat_user(redis, chat_id, user_id)
    await local_manager.add(user_id, websocket)
    listener_ready = asyncio.Event()

    async def send_event(event_data: str) -> None:
        event = WsEvent.model_validate_json(event_data)
        await websocket.send_text(event.model_dump_json())

    task = asyncio.create_task(
        redis_pubsub_listener(
            chat_id=chat_id,
            redis=redis,
            send_event=send_event,
            ready_event=listener_ready,
        ),
    )
    try:
        await listener_ready.wait()
        if share_presence:
            await RedisDao.publish_chat_event(
                redis,
                chat_id,
                WsEvent(
                    event="user:presence",
                    data={"chat_id": chat_id, "user_id": user_id, "online": True},
                ).model_dump_json(),
            )
        while True:
            msg = WsEvent.model_validate(await websocket.receive_json())
            if msg.event == "message:new":
                msg.data.is_forwarded = False
                await RedisDao.publish_chat_event(redis, chat_id, msg.model_dump_json())
            elif msg.event == "user:typing":
                msg.data.user_id = user_id
                await RedisDao.publish_chat_event(redis, chat_id, msg.model_dump_json())
    except (WebSocketDisconnect, ValidationError):
        pass
    finally:
        await local_manager.remove(user_id)
        await RedisDao.remove_chat_user(redis, chat_id, user_id)
        if share_presence:
            await RedisDao.publish_chat_event(
                redis,
                chat_id,
                WsEvent(
                    event="user:presence",
                    data={"chat_id": chat_id, "user_id": user_id, "online": False},
                ).model_dump_json(),
            )
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
