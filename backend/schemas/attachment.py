import uuid
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class AvatarUrlRequest(BaseModel):
    file_extension: str
    file_content: str
    target_id: str
    type: Literal["message", "chat_avatar", "user_avatar"]


class AvatarUrlResponse(BaseModel):
    user_id: Optional[uuid.UUID] = None
    chat_id: Optional[uuid.UUID] = None
    temporary_url: str
    file_key: str


class AttachmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: Optional[uuid.UUID] = None
    chat_id: Optional[uuid.UUID]
    is_avatar: bool = False
    file_key: str
    file_name: str
    file_size: int = Field(ge=0)
    mime_type: str
    text: Optional[str] = None


class AttachmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    file_key: str
    file_name: str
    file_size: int
    mime_type: str
    text: str | None = None
    user_id: Optional[uuid.UUID] = None
    chat_id: Optional[uuid.UUID] = None
