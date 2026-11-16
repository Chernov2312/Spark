import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class UserRead(BaseModel):
    id: uuid.UUID = Field(..., description="user_id")
    username: str = Field(..., max_length=50)
    tag: str = Field(..., max_length=32)
    email: EmailStr = Field(..., max_length=100)

    avatar_urls: list[str] = Field(default_factory=list)
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, max_length=50)
    tag: Optional[str] = Field(default=None, min_length=3, max_length=32)
    email: Optional[str] = Field(default=None, max_length=100)

    model_config = ConfigDict(from_attributes=True)


class AvatarRequest(BaseModel):
    file_key: str
    content_type: str


class Avatar(BaseModel):
    url: str = Field(..., max_length=512)


class UserQuery(BaseModel):
    username: str
    limit: int = 20


class UserResponse(BaseModel):
    id: uuid.UUID
    username: str
    tag: str
    model_config = ConfigDict(from_attributes=True)


class UserListResponse(BaseModel):
    users: List[UserResponse] = Field(default_factory=[])
