import uuid
from datetime import datetime
from typing import Any, Literal, Union

from pydantic import BaseModel, Field, model_validator


class UserData(BaseModel):
    id: uuid.UUID
    text: str | None = None
    chat_id: uuid.UUID
    attachments: list[dict[str, Any]] = Field(default_factory=list)
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


class AttachmentText(BaseModel):
    chat_id: uuid.UUID
    message_id: uuid.UUID
    attachment_id: uuid.UUID
    user_id: uuid.UUID
    text: str = ""
    error: bool = False


class WsEvent(BaseModel):
    event: Literal["user:typing", "chat:update", "message:new", "attachment:text"]
    data: Union[UserData, ChatData, UserTyping, AttachmentText]

    @model_validator(mode="before")
    @classmethod
    def validate_and_route_data(cls, data: Any) -> Any:
        if isinstance(data, dict):
            event_type = data.get("event")
            event_data = data.get("data")
            mapping = {
                "message:new": UserData,
                "chat:update": ChatData,
                "user:typing": UserTyping,
                "attachment:text": AttachmentText,
            }

            target_model = mapping.get(event_type)

            if target_model and isinstance(event_data, dict):
                data["data"] = target_model.model_validate(event_data)
        return data
