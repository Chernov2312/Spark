from datetime import datetime
from typing import Dict, List, Literal, Optional
import uuid

from pydantic import BaseModel, EmailStr, Field


class AuthResponse(BaseModel):
    id: uuid.UUID
    username: str
    email: EmailStr
    access_token: str
    token_type: Literal["bearer"]


class UserProfile(BaseModel):
    id: uuid.UUID
    username: str
    email: EmailStr
    avatar_urls: List[str]
    created_at: datetime


class UserProfileUpdate(BaseModel):
    id: uuid.UUID
    username: str
    email: EmailStr
    avatar_urls: Optional[str]
    updated_at: datetime


class NewAvatarUrl(BaseModel):
    avatar_url: str


class ChatModel(BaseModel):
    id: uuid.UUID
    title: str
    description: Optional[str]
    owner_id: uuid.UUID
    avatar_urls: List[str] = Field(default_factory=list)
    created_at: datetime


class NewChatResponse(BaseModel):
    id: uuid.UUID
    title: str
    description: Optional[str]
    owner_id: uuid.UUID
    users_count: int
    avatar_urls: List[str] = Field(default_factory=list)
    created_at: datetime


class GetChats(BaseModel):
    chats: List[ChatModel]


class UpdateChatUrl(BaseModel):
    chat_avatar_url: str


class AttachmentModel(BaseModel):
    id: uuid.UUID
    url: str
    file_name: str
    mime_type: str


class MessageModel(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    user_id: uuid.UUID
    text: str
    reactions_count: Dict[str, int] = Field(default_factory=dict)
    user_reaction: Optional[str]
    attachments: List[AttachmentModel] = Field(default_factory=list)


class GetMessageHistory(BaseModel):
    messages: List[MessageModel] = Field(default_factory=list)
