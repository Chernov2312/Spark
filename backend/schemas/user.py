from datetime import date, datetime
from typing import Literal, List, Optional
import uuid

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ProfileVisibility(BaseModel):
    avatar: Literal["everyone", "friends", "nobody"] = "everyone"
    bio: Literal["everyone", "friends", "nobody"] = "everyone"
    birth_date: Literal["everyone", "friends", "nobody"] = "everyone"


class ProfileExceptions(BaseModel):
    avatar: list[str] = Field(default_factory=list, max_length=100)
    bio: list[str] = Field(default_factory=list, max_length=100)
    birth_date: list[str] = Field(default_factory=list, max_length=100)


class UserRead(BaseModel):
    id: uuid.UUID = Field(..., description="user_id")
    username: str = Field(..., max_length=50)
    tag: str = Field(..., max_length=32)
    email: EmailStr = Field(..., max_length=100)
    bio: str | None = None
    birth_date: date | None = None
    profile_visibility: ProfileVisibility = Field(default_factory=ProfileVisibility)
    profile_exceptions: ProfileExceptions = Field(default_factory=ProfileExceptions)

    avatar_urls: list[str] = Field(default_factory=list)
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class UserUpdate(BaseModel):
    username: Optional[str] = Field(default=None, max_length=50)
    tag: Optional[str] = Field(default=None, min_length=3, max_length=32)
    email: Optional[str] = Field(default=None, max_length=100)
    bio: Optional[str] = Field(default=None, max_length=500)
    birth_date: date | None = None
    profile_visibility: ProfileVisibility | None = None
    profile_exceptions: ProfileExceptions | None = None

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
