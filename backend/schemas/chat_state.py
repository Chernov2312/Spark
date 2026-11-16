from typing import Literal
import uuid

from pydantic import BaseModel


class ChatMemberResponse(BaseModel):
    id: uuid.UUID
    username: str
    tag: str
    role: Literal["owner", "moderator", "member"]
    last_read_message_id: uuid.UUID | None = None


class ChatMemberRoleUpdate(BaseModel):
    role: Literal["moderator", "member"]


class MarkChatReadRequest(BaseModel):
    message_id: uuid.UUID | None = None


class MarkChatReadResponse(BaseModel):
    last_read_message_id: uuid.UUID | None


class ChatMemberListResponse(BaseModel):
    members: list[ChatMemberResponse]
