import uuid

from pydantic import BaseModel


class UserData(BaseModel):
    id: uuid.UUID
    text: str
    chat_id: uuid.UUID
    attachments: list[str]
    user_id: uuid.UUID


class ChatData(BaseModel):
    chat_id: uuid.UUID
    title: str
    avatar_url: str


class UserTyping(BaseModel):
    chat_id: uuid.UUID


class WsEvent(BaseModel):
    event: str
    data: UserData | ChatData | UserTyping
