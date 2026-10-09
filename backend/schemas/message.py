import uuid
from datetime import datetime
from typing import List

from pydantic import BaseModel, ConfigDict


class MessageResponse(BaseModel):
    id: uuid.UUID
    chat_id: uuid.UUID
    user_id: uuid.UUID
    text: str
    reactions_count: dict[str, int]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class MessageHistory(BaseModel):
    messages: List[MessageResponse]

    model_config = ConfigDict(from_attributes=True)


class MessageRequest(BaseModel):
    text: str
