import uuid
import asyncio
from fastapi import WebSocket, APIRouter, Query
import redis.asyncio as aioredis
from core.dependencies import get_redis
from schemas.message import MessageInternalDTO
async def get_cached_user_chats(user_id: str, redis:aioredis.Redis) -> list[str]:
    redis_key = f"user:{user_id}:chats"
    chats = [c for c in await redis.smembers(redis_key)]
    return chats
async def redis_listener(websocket: WebSocket, user_id: str, initial_chats: list[str], redis: aioredis.Redis):
    pubsub = redis.pubsub()
    
    control_channel = f"user:{user_id}:control"
    channels = [f"chat:{chat_id}" for chat_id in initial_chats]
    channels.append(control_channel)
    
    await pubsub.subscribe(*channels)
    
    try:
        async for message in pubsub.listen():
            if message["type"] != "message":
                continue
                
            channel_name = message["channel"].decode("utf-8")
            data = json.loads(message["data"].decode("utf-8"))

            if channel_name == control_channel:
                if data.get("action") == "subscribe_to_new_chat":
                    new_chat_id = data.get("chat_id")
                    new_channel = f"chat:{new_chat_id}"
                    await pubsub.subscribe(new_channel)
                    print(f"Сокет пользователя {user_id} динамически подписался на {new_channel}")
                continue
                
            await websocket.send_json(data)
            
    except asyncio.CancelledError:
        await pubsub.unsubscribe()
    finally:
        await pubsub.close()
chat_websocket = APIRouter()


@chat_websocket.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, token: str):
    user_id = "u1111111-eeee-aaaa-bbbb-cccccccccccc" 
    await websocket.accept()
    
    user_chat_ids = await get_cached_user_chats(user_id)
    listener_task = asyncio.create_task(
        redis_listener(websocket, user_id, user_chat_ids)
    )
    
    try:
        while True:
            client_data = await websocket.receive_json()
            event = client_data.get("event")
            event_data = client_data.get("data", {})
            
            if event == "chat:typing":
                chat_id = event_data.get("chat_id")
                typing_payload = {
                    "event": "user:typing",
                    "data": {"chat_id": chat_id, "user_id": user_id}
                }
                # Транслируем статус печати в канал чата
                await redis.publish(f"chat:{chat_id}", json.dumps(typing_payload))
                
    except WebSocketDisconnect:
        listener_task.cancel()