from typing import Literal

from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: Literal["healthy"]


class PasswordResetMessageResponse(BaseModel):
    message: str


class ChatMemberRoleResponse(BaseModel):
    role: Literal["member", "moderator"]


class MessagePinnedResponse(BaseModel):
    pinned: bool


class AudioTranscriptionResponse(BaseModel):
    queued: bool


class MessageDeletedResponse(BaseModel):
    deleted: Literal[True]


class AttachmentDownloadResponse(BaseModel):
    url: str
