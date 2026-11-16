import uuid

from fastapi import Request, WebSocket

from infrastructure.redis.client import Redis


async def get_redis(request: Request) -> Redis:
    return request.app.state.redis


class ManagerConnection:
    def __init__(self) -> None:
        self.local_connections: dict[uuid.UUID, WebSocket] = {}

    async def add(self, user_id: uuid.UUID, websocket: WebSocket) -> None:
        self.local_connections[user_id] = websocket

    async def remove(self, user_id: uuid.UUID) -> None:
        self.local_connections.pop(user_id, None)

    async def send(self, user_id: uuid.UUID, message: str) -> None:
        websocket = self.local_connections.get(user_id)
        if websocket:
            await websocket.send_text(message)


local_manager = ManagerConnection()
