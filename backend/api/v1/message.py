from fastapi import APIRouter

message_router = APIRouter(prefix="api/v1/chats")
@message_router.get("{chat_id}")