from datetime import datetime
from typing import List
import uuid

from pydantic import BaseModel, ConfigDict, Field, model_validator

from schemas.attachment import AttachmentRequest, AttachmentResponse


class MessageRequest(BaseModel):
    text: str | None = None
    link_preview_url: str | None = Field(default=None, max_length=2048)
    reply_to_id: uuid.UUID | None = None
    thread_root_id: uuid.UUID | None = None
    attachments: list[AttachmentRequest] = Field(default_factory=list, max_length=10)

    @model_validator(mode="after")
    def validate_not_empty(self) -> "MessageRequest":
        has_text = bool(self.text and self.text.strip())
        if not has_text and not self.attachments:
            raise ValueError("Message must contain text or at least one attachment")
        return self


class LinkPreview(BaseModel):
    url: str = Field(max_length=2048)
    title: str = Field(min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=320)


class MessageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    chat_id: uuid.UUID
    user_id: uuid.UUID
    text: str | None = None
    reply_to_id: uuid.UUID | None = None
    reply_to_text: str | None = None
    thread_root_id: uuid.UUID | None = None
    thread_reply_count: int = 0
    edited_at: datetime | None = None
    is_forwarded: bool = False
    is_pinned: bool = False
    poll_id: uuid.UUID | None = None
    link_preview: LinkPreview | None = None
    user_reaction: str | None = None
    attachments: list[AttachmentResponse] = Field(default_factory=list)
    reactions_count: dict[str, int] = Field(default_factory=dict)
    created_at: datetime


class MessageHistory(BaseModel):
    messages: List[MessageResponse]

    model_config = ConfigDict(from_attributes=True)


class MessageForwardRequest(BaseModel):
    target_chat_id: uuid.UUID
    link_preview_url: str | None = Field(default=None, max_length=2048)


class MessageInternalDTO(MessageRequest):
    id: uuid.UUID
    text: str | None
    attachments: List[AttachmentRequest] = Field(default_factory=list)
    chat_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime = Field(default_factory=datetime.now)
