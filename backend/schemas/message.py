import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Attachment(BaseModel):
    id: uuid.UUID
    attachment_url: str
    text: Optional[str]


class MessageResponse(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    user_id: uuid.UUID
    text: str | None
    user_reaction: str = None
    attachments: Optional[List[Attachment]] = Field(default_factory=[])
    reactions_count: dict[str, int]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MessageHistory(BaseModel):
    messages: List[MessageResponse]

    model_config = ConfigDict(from_attributes=True)


class MessageRequest(BaseModel):
    text: str | None
    attachments: List[dict] = Field(default_factory=list)

    @model_validator(mode="after")
    def check_fields(self):
        if self.text is None and self.attachments is None:
            raise ValueError("Empty message")
        return self


class MessageInternalDTO(MessageRequest):
    id: uuid.UUID
    text: str | None
    attachments: List[dict[str, str]] = Field(default_factory=list)
    chat_id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime = Field(default_factory=datetime.utcnow)
