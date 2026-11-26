from datetime import datetime
from typing import Literal, Union
import uuid

from pydantic import BaseModel, Field, model_validator

from schemas.attachment import AttachmentResponse
from schemas.message import LinkPreview


class UserData(BaseModel):
    id: uuid.UUID
    is_forwarded: bool = False
    forward_caption: str | None = None
    text: str | None = None
    chat_id: uuid.UUID
    attachments: list[AttachmentResponse] = Field(default_factory=list)
    user_id: uuid.UUID
    poll_id: uuid.UUID | None = None
    created_at: datetime | None = None
    user_reaction: str | None = None
    reactions_count: dict[str, int] = Field(default_factory=dict)
    reply_to_id: uuid.UUID | None = None
    reply_to_text: str | None = None
    thread_root_id: uuid.UUID | None = None
    thread_reply_count: int = 0


class ChatData(BaseModel):
    chat_id: uuid.UUID
    title: str
    avatar_url: str


class UserTyping(BaseModel):
    chat_id: uuid.UUID
    user_id: uuid.UUID | None = None


class UserPresence(BaseModel):
    chat_id: uuid.UUID
    user_id: uuid.UUID
    online: bool


class UserRead(BaseModel):
    chat_id: uuid.UUID
    user_id: uuid.UUID
    last_read_message_id: uuid.UUID | None = None


class AttachmentText(BaseModel):
    chat_id: uuid.UUID
    message_id: uuid.UUID
    attachment_id: uuid.UUID
    user_id: uuid.UUID
    text: str = ""
    error: bool = False


class MessageDeleted(BaseModel):
    chat_id: uuid.UUID
    message_id: uuid.UUID


class PollUpdated(BaseModel):
    chat_id: uuid.UUID
    poll_id: uuid.UUID
    message_id: uuid.UUID
    version: int


class MessageUpdated(UserData):
    link_preview: LinkPreview | None = None
    is_pinned: bool = False
    edited_at: datetime | None = None
    reply_to_id: uuid.UUID | None = None
    reply_to_text: str | None = None
    attachments: list[AttachmentResponse] = Field(default_factory=list)


class MessageLinkPreview(BaseModel):
    chat_id: uuid.UUID
    message_id: uuid.UUID
    preview: LinkPreview


class WsEvent(BaseModel):
    event: Literal[
        "user:typing",
        "user:presence",
        "user:read",
        "chat:update",
        "message:new",
        "message:updated",
        "message:deleted",
        "message:link-preview",
        "attachment:text",
        "poll:updated",
    ]
    data: Union[
        UserData,
        ChatData,
        UserTyping,
        UserPresence,
        UserRead,
        AttachmentText,
        MessageUpdated,
        MessageDeleted,
        MessageLinkPreview,
        PollUpdated,
    ]

    @model_validator(mode="before")
    @classmethod
    def validate_and_route_data(cls, data: object) -> object:
        if isinstance(data, dict):
            event_type = data.get("event")
            event_data = data.get("data")
            mapping = {
                "message:new": UserData,
                "message:updated": MessageUpdated,
                "message:deleted": MessageDeleted,
                "message:link-preview": MessageLinkPreview,
                "chat:update": ChatData,
                "user:typing": UserTyping,
                "user:presence": UserPresence,
                "user:read": UserRead,
                "attachment:text": AttachmentText,
                "poll:updated": PollUpdated,
            }

            target_model = mapping.get(event_type)

            if target_model and isinstance(event_data, dict):
                data["data"] = target_model.model_validate(event_data)
        return data
