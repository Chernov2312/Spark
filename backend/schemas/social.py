from typing import Literal
import uuid

from pydantic import BaseModel, Field


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class FriendCategoryUpdate(BaseModel):
    category_id: uuid.UUID | None = None


class ChatFolderUpdate(BaseModel):
    folder_id: uuid.UUID | None = None


class FriendSummaryResponse(BaseModel):
    id: uuid.UUID
    username: str
    tag: str


class FriendResponse(FriendSummaryResponse):
    category_id: uuid.UUID | None = None


class FriendCategoryResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: str | None
    is_default: bool


class FriendsListResponse(BaseModel):
    friends: list[FriendResponse]
    requests: list[FriendSummaryResponse]
    sent_requests: list[FriendSummaryResponse]
    categories: list[FriendCategoryResponse]


class ChatFolderResponse(BaseModel):
    id: uuid.UUID
    name: str
    color: str | None
    is_default: bool
    chat_ids: list[uuid.UUID]


class ChatFoldersListResponse(BaseModel):
    folders: list[ChatFolderResponse]


class SocialStatusResponse(BaseModel):
    status: Literal["accepted", "pending", "success"]
