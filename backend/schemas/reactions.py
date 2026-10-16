import uuid

from pydantic import BaseModel, Field


class ReactionsRequest(BaseModel):
    emoji: str = Field(..., max_length=1)


class ReactionsResponse(BaseModel):
    message_id: uuid.UUID
    updated_reactions_count: dict[str, int]
