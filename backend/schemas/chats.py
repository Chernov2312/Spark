import uuid

from pydantic import BaseModel, Field


class NewChatRequest(BaseModel):
    title: str = Field(..., max_length=50)
    description: str = Field(..., max_length=150)
    invited_user_ids: list[str]
