import uuid

from pydantic import BaseModel, Field


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
