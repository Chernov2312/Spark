import uuid
from typing import Any, Literal, Union

from pydantic import BaseModel, model_validator


class UserData(BaseModel):
    id: uuid.UUID
    text: str
    chat_id: uuid.UUID
    attachments: list[str] = []
    user_id: uuid.UUID


class ChatData(BaseModel):
    chat_id: uuid.UUID
    title: str
    avatar_url: str


class UserTyping(BaseModel):
    chat_id: uuid.UUID
    user_id: uuid.UUID = None


class WsEvent(BaseModel):
    event: Literal["user:typing", "chat:update", "message:new"]
    data: Union[UserData, ChatData, UserTyping]

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
            }

            target_model = mapping.get(event_type)

            if target_model and isinstance(event_data, dict):
                data["data"] = target_model.model_validate(event_data)
        return data
