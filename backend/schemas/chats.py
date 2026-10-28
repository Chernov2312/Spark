import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field


class PatchChatRequest(BaseModel):
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)


class ChatAddUserRequest(BaseModel):
    user_ids: List[uuid.UUID]


class NewChatRequest(BaseModel):
    id: Optional[uuid.UUID]
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    invited_user_ids: List[str]
    avatar_urls: List[str] = Field(default_factory=list)


class NewChatResponse(BaseModel):
    id: uuid.UUID
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    invited_user_ids: List[uuid.UUID]
    users_count: int
    avater_urls: List[str] = Field(default_factory=list)
    owner_id: str = Field(...)
    created_at: datetime


class ChatResponse(BaseModel):
    id: uuid.UUID
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    avatar_urls: List[str] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class GetChatsResponse(BaseModel):
    chats: List[ChatResponse] = Field(default_factory=list)


class AddUserToChatResponse(BaseModel):
    status: str
