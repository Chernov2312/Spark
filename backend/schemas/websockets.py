from datetime import datetime
from typing import Literal, Union
import uuid

from pydantic import BaseModel, Field, model_validator

from schemas.attachment import AttachmentResponse


class UserData(BaseModel):
    id: uuid.UUID
    text: str | None = None
    chat_id: uuid.UUID
    attachments: list[AttachmentResponse] = Field(default_factory=list)
    user_id: uuid.UUID
    created_at: datetime | None = None
    user_reaction: str | None = None
    reactions_count: dict[str, int] = Field(default_factory=dict)


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


class MessageUpdated(UserData):
    edited_at: datetime | None = None
    reply_to_id: uuid.UUID | None = None
    reply_to_text: str | None = None
    attachments: list[AttachmentResponse] = Field(default_factory=list)


class WsEvent(BaseModel):
    event: Literal[
        "user:typing",
        "user:presence",
        "user:read",
        "chat:update",
        "message:new",
        "message:updated",
        "message:deleted",
        "attachment:text",
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
                "chat:update": ChatData,
                "user:typing": UserTyping,
                "user:presence": UserPresence,
                "user:read": UserRead,
                "attachment:text": AttachmentText,
            }

            target_model = mapping.get(event_type)

            if target_model and isinstance(event_data, dict):
                data["data"] = target_model.model_validate(event_data)
        return data
