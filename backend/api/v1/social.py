import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, or_, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_id_current_user
from db.database import get_session
from db.models import (
    chat_folder_chats,
    ChatFolder,
    FriendCategory,
    Friendship,
    friendship_categories,
    User,
    user_chat,
)

social_router = APIRouter(prefix="/api/v1", tags=[RouteTags.USERS])


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    color: str | None = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")


class FriendCategoryUpdate(BaseModel):
    category_id: uuid.UUID | None = None


class ChatFolderUpdate(BaseModel):
    folder_id: uuid.UUID | None = None


async def _other_user(
    session: AsyncSession,
    friendship: Friendship,
    current_user_id: uuid.UUID,
) -> User:
    other_id = (
        friendship.user_high_id
        if friendship.user_low_id == current_user_id
        else friendship.user_low_id
    )
    return await session.get(User, other_id)


@social_router.get("/friends")
async def list_friends(
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    categories = (
        await session.scalars(
            select(FriendCategory)
            .where(FriendCategory.owner_id == current_user_id)
            .order_by(FriendCategory.is_default.desc(), FriendCategory.name),
        )
    ).all()
    friendship_rows = (
        await session.scalars(
            select(Friendship)
            .where(
                Friendship.status == "accepted",
                or_(
                    Friendship.user_low_id == current_user_id,
                    Friendship.user_high_id == current_user_id,
                ),
            )
            .order_by(Friendship.created_at.desc()),
        )
    ).all()
    pending_rows = (
        await session.scalars(
            select(Friendship)
            .where(
                Friendship.status == "pending",
                Friendship.requested_by_id != current_user_id,
                or_(
                    Friendship.user_low_id == current_user_id,
                    Friendship.user_high_id == current_user_id,
                ),
            )
            .order_by(Friendship.created_at.desc()),
        )
    ).all()
    sent_rows = (
        await session.scalars(
            select(Friendship)
            .where(
                Friendship.status == "pending",
                Friendship.requested_by_id == current_user_id,
                or_(
                    Friendship.user_low_id == current_user_id,
                    Friendship.user_high_id == current_user_id,
                ),
            )
            .order_by(Friendship.created_at.desc()),
        )
    ).all()

    friends = []
    for friendship in friendship_rows:
        friend = await _other_user(session, friendship, current_user_id)
        category_id = await session.scalar(
            select(friendship_categories.c.category_id).where(
                friendship_categories.c.friendship_id == friendship.id,
                friendship_categories.c.owner_id == current_user_id,
            ),
        )
        friends.append(
            {
                "id": str(friend.id),
                "username": friend.username,
                "tag": friend.tag,
                "category_id": str(category_id) if category_id else None,
            },
        )

    requests = []
    for friendship in pending_rows:
        friend = await _other_user(session, friendship, current_user_id)
        requests.append(
            {
                "id": str(friend.id),
                "username": friend.username,
                "tag": friend.tag,
            },
        )

    sent_requests = []
    for friendship in sent_rows:
        friend = await _other_user(session, friendship, current_user_id)
        sent_requests.append(
            {
                "id": str(friend.id),
                "username": friend.username,
                "tag": friend.tag,
            },
        )

    return {
        "friends": friends,
        "requests": requests,
        "sent_requests": sent_requests,
        "categories": [
            {
                "id": str(category.id),
                "name": category.name,
                "color": category.color,
                "is_default": category.is_default,
            }
            for category in categories
        ],
    }


@social_router.post("/friends/categories", status_code=status.HTTP_201_CREATED)
async def create_friend_category(
    data: CategoryCreate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    category = FriendCategory(
        owner_id=current_user_id,
        name=data.name.strip(),
        color=data.color,
    )
    if not category.name:
        raise HTTPException(status_code=422, detail="Category name cannot be empty")
    session.add(category)
    try:
        await session.flush()
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Category already exists") from error
    return {
        "id": str(category.id),
        "name": category.name,
        "color": category.color,
        "is_default": category.is_default,
    }


@social_router.post("/friends/{friend_id}/request", status_code=status.HTTP_200_OK)
async def request_friendship(
    friend_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    if friend_id == current_user_id:
        raise HTTPException(status_code=400, detail="You cannot add yourself")
    if await session.get(User, friend_id) is None:
        raise HTTPException(status_code=404, detail="User not found")

    low_id, high_id = sorted((current_user_id, friend_id), key=str)
    friendship = await session.scalar(
        select(Friendship).where(
            Friendship.user_low_id == low_id,
            Friendship.user_high_id == high_id,
        ),
    )
    if friendship is None:
        friendship = Friendship(
            user_low_id=low_id,
            user_high_id=high_id,
            requested_by_id=current_user_id,
            status="pending",
        )
        session.add(friendship)
    elif friendship.status == "accepted":
        return {"status": "accepted"}
    elif friendship.status == "pending":
        if friendship.requested_by_id != current_user_id:
            friendship.status = "accepted"
            return {"status": "accepted"}
        return {"status": "pending"}
    else:
        friendship.requested_by_id = current_user_id
        friendship.status = "pending"
    return {"status": friendship.status}


@social_router.post("/friends/{friend_id}/accept")
async def accept_friendship(
    friend_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    low_id, high_id = sorted((current_user_id, friend_id), key=str)
    friendship = await session.scalar(
        select(Friendship).where(
            Friendship.user_low_id == low_id,
            Friendship.user_high_id == high_id,
            Friendship.status == "pending",
            Friendship.requested_by_id != current_user_id,
        ),
    )
    if friendship is None:
        raise HTTPException(status_code=404, detail="Friend request not found")
    friendship.status = "accepted"
    return {"status": "accepted"}


@social_router.patch("/friends/{friend_id}/category")
async def set_friend_category(
    friend_id: uuid.UUID,
    data: FriendCategoryUpdate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    low_id, high_id = sorted((current_user_id, friend_id), key=str)
    friendship = await session.scalar(
        select(Friendship).where(
            Friendship.user_low_id == low_id,
            Friendship.user_high_id == high_id,
            Friendship.status == "accepted",
        ),
    )
    if friendship is None:
        raise HTTPException(status_code=404, detail="Friend not found")
    await session.execute(
        delete(friendship_categories).where(
            friendship_categories.c.friendship_id == friendship.id,
            friendship_categories.c.owner_id == current_user_id,
        ),
    )
    if data.category_id is not None:
        category = await session.scalar(
            select(FriendCategory).where(
                FriendCategory.id == data.category_id,
                FriendCategory.owner_id == current_user_id,
            ),
        )
        if category is None:
            raise HTTPException(status_code=404, detail="Category not found")
        await session.execute(
            insert(friendship_categories).values(
                friendship_id=friendship.id,
                owner_id=current_user_id,
                category_id=category.id,
            ),
        )
    return {"status": "success"}


@social_router.get("/chat-folders")
async def list_chat_folders(
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    folders = (
        await session.scalars(
            select(ChatFolder)
            .where(ChatFolder.owner_id == current_user_id)
            .order_by(ChatFolder.is_default.desc(), ChatFolder.name),
        )
    ).all()
    result = []
    for folder in folders:
        chat_ids = (
            await session.scalars(
                select(chat_folder_chats.c.chat_id).where(
                    chat_folder_chats.c.folder_id == folder.id,
                    chat_folder_chats.c.owner_id == current_user_id,
                ),
            )
        ).all()
        result.append(
            {
                "id": str(folder.id),
                "name": folder.name,
                "color": folder.color,
                "is_default": folder.is_default,
                "chat_ids": [str(chat_id) for chat_id in chat_ids],
            },
        )
    return {"folders": result}


@social_router.post("/chat-folders", status_code=status.HTTP_201_CREATED)
async def create_chat_folder(
    data: CategoryCreate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    folder = ChatFolder(
        owner_id=current_user_id,
        name=data.name.strip(),
        color=data.color,
    )
    if not folder.name:
        raise HTTPException(status_code=422, detail="Folder name cannot be empty")
    session.add(folder)
    try:
        await session.flush()
    except IntegrityError as error:
        raise HTTPException(status_code=409, detail="Folder already exists") from error
    return {
        "id": str(folder.id),
        "name": folder.name,
        "color": folder.color,
        "is_default": folder.is_default,
        "chat_ids": [],
    }


@social_router.patch("/chats/{chat_id}/folder")
async def set_chat_folder(
    chat_id: uuid.UUID,
    data: ChatFolderUpdate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
):
    member = await session.scalar(
        select(user_chat.c.chat_id).where(
            user_chat.c.chat_id == chat_id,
            user_chat.c.user_id == current_user_id,
        ),
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    await session.execute(
        delete(chat_folder_chats).where(
            chat_folder_chats.c.chat_id == chat_id,
            chat_folder_chats.c.owner_id == current_user_id,
        ),
    )
    if data.folder_id is not None:
        folder = await session.scalar(
            select(ChatFolder).where(
                ChatFolder.id == data.folder_id,
                ChatFolder.owner_id == current_user_id,
            ),
        )
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        await session.execute(
            insert(chat_folder_chats).values(
                folder_id=folder.id,
                chat_id=chat_id,
                owner_id=current_user_id,
            ),
        )
    return {"status": "success"}
