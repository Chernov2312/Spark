import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserRead(BaseModel):
    id: uuid.UUID = Field(..., description="user_id")
    username: str = Field(..., max_length=50)
    email: EmailStr = Field(..., max_length=100)

    avatar_urls: list[str] = Field(default_factory=list)
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, max_length=50)
    email: Optional[str] = Field(default=None, max_length=100)

    model_config = ConfigDict(from_attributes=True)


class Avatar(BaseModel):
    url: str = Field(..., max_length=512)
