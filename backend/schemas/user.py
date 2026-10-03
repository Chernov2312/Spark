import uuid
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UserRead(BaseModel):
    id: uuid.UUID = Field(..., description="user_id")
    username: str = Field(..., max_length=50)
    email: str = Field(..., max_length=100)
    avatar_url: Optional[str] = Field(default=None, max_length=512)

    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, max_length=50)
    email: Optional[str] = Field(default=None, max_length=100)
    avatar_url: Optional[str] = Field(default=None, max_length=512)

    model_config = ConfigDict(from_attributes=True)
