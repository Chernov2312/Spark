import asyncio
import uuid

import redis.asyncio as aioredis
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from core.dependencies import local_manager, redis_pubsub_listener
from core.security import get_id_current_user
from schemas.websockets import WsEvent

ws_router = APIRouter()


@ws_router.websocket("/{chat_id}/ws")
async def on_message(
    websocket: WebSocket,
    chat_id: uuid.UUID,
    token: str = Query(),
):
    await websocket.accept()
    redis: aioredis.Redis = websocket.app.state.redis
    user_id = await get_id_current_user(token)
    users_key = f"chat:{chat_id}:users"
    await redis.sadd(users_key, str(user_id))
    await local_manager.add(user_id, websocket)
    task = asyncio.create_task(
        redis_pubsub_listener(chat_id=chat_id, redis=redis, websocket=websocket),
    )
    try:
        while True:
            msg = WsEvent.model_validate(await websocket.receive_json())
            if (
                msg.event == "message:new"
                or msg.event == "chat:updated"
                or msg.event == "user:typing"
            ):
                await redis.publish(f"chat:{chat_id}", msg.model_dump_json())

    except (WebSocketDisconnect, ValidationError):
        await local_manager.remove(user_id)
        await redis.srem(users_key, str(user_id))
        task.cancel()
