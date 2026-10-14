import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class PatchChatRequest(BaseModel):
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)


class ChatAddUserRequest(BaseModel):
    user_ids: list[uuid.UUID]


class NewChatRequest(BaseModel):
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    invited_user_ids: list[str]


class NewChatResponse(BaseModel):
    id: uuid.UUID
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    invited_user_ids: list[str]
    users_count: int
    owner_id: str = Field(...)


class ChatResponse(BaseModel):
    id: uuid.UUID
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    avatar_url: str = None
    model_config = ConfigDict(from_attributes=True)


class GetChatsResponse(BaseModel):
    chats: list[ChatResponse]


class AddUserToChatResponse(BaseModel):
    status: str
