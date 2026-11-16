from datetime import datetime
from typing import List, Optional
import uuid

from pydantic import BaseModel, ConfigDict, Field


class PatchChatRequest(BaseModel):
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)


class ChatAddUserRequest(BaseModel):
    user_ids: List[uuid.UUID]


class NewChatRequest(BaseModel):
    id: Optional[uuid.UUID] = None
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    invited_user_ids: List[uuid.UUID]
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


class ChatPreviewAttachment(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file_name: str
    mime_type: str


class ChatMessagePreview(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    text: str | None = None
    created_at: datetime
    thread_root_id: uuid.UUID | None = None
    attachments: list[ChatPreviewAttachment] = Field(default_factory=list)


class ChatResponse(BaseModel):
    id: uuid.UUID
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    owner_id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    avatar_urls: List[str] = Field(default_factory=list)
    last_message: ChatMessagePreview | None = None
    personal_avatar_url: str | None = None

    model_config = ConfigDict(from_attributes=True)


class GetChatsResponse(BaseModel):
    chats: List[ChatResponse] = Field(default_factory=list)


class AddUserToChatResponse(BaseModel):
    status: str


class ChatPersonalAvatarRequest(BaseModel):
    file_key: str = Field(min_length=1, max_length=512)


class ChatPersonalAvatarResponse(BaseModel):
    personal_avatar_url: str | None = None
