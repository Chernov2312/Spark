import asyncio
import uuid

from fastapi import Request, WebSocket
import redis.asyncio as aioredis

from schemas.websockets import WsEvent


async def get_redis(request: Request) -> aioredis.Redis:
    return request.app.state.redis


class ManagerConnection:
    def __init__(self):
        self.localconnections: dict[uuid.UUID, WebSocket] = dict()

    async def add(self, user_id: uuid.UUID, websocket: WebSocket):
        self.localconnections[user_id] = websocket

    async def remove(self, user_id: uuid.UUID):
        self.localconnections.pop(user_id, None)

    async def send(self, user_id: uuid.UUID, message: str):
        websocket = self.localconnections.get(user_id, None)
        if websocket:
            await websocket.send_text(message)


local_manager = ManagerConnection()


async def redis_pubsub_listener(
    chat_id: uuid.UUID,
    redis: aioredis.Redis,
    websocket: WebSocket,
):
    channel_key = f"chat:{chat_id}"
    pubsub = redis.pubsub()
    await pubsub.subscribe(channel_key)
    try:
        async for message in pubsub.listen():
            if message.get("type") == "message":
                msg = WsEvent.model_validate_json(message.get("data"))
                await websocket.send_text(msg.model_dump_json())
    except asyncio.CancelledError:
        await pubsub.unsubscribe()
