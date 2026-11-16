import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_id_current_user
from db.dao.exceptions import DuplicateResourceError
from db.dao.social_dao import SocialDao
from db.database import get_session
from db.models import Friendship
from schemas.social import (
    CategoryCreate,
    ChatFolderResponse,
    ChatFoldersListResponse,
    ChatFolderUpdate,
    FriendCategoryResponse,
    FriendCategoryUpdate,
    FriendResponse,
    FriendsListResponse,
    FriendSummaryResponse,
    SocialStatusResponse,
)

social_router = APIRouter(prefix="/api/v1", tags=[RouteTags.USERS])


@social_router.get("/friends")
async def list_friends(
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> FriendsListResponse:
    categories = await SocialDao.list_friend_categories(session, current_user_id)
    friendships = await SocialDao.list_friendships(
        session,
        current_user_id,
        status="accepted",
    )
    incoming = await SocialDao.list_friendships(
        session,
        current_user_id,
        status="pending",
        incoming_only=True,
    )
    outgoing = await SocialDao.list_friendships(
        session,
        current_user_id,
        status="pending",
        requested_by_id=current_user_id,
    )

    friends: list[FriendResponse] = []
    for friendship in friendships:
        friend = await SocialDao.get_other_friend(
            session,
            friendship,
            current_user_id,
        )
        category_id = await SocialDao.get_friend_category_id(
            session,
            friendship.id,
            current_user_id,
        )
        if friend is not None:
            friends.append(
                FriendResponse(
                    id=friend.id,
                    username=friend.username,
                    tag=friend.tag,
                    category_id=category_id,
                ),
            )

    async def serialize_requests(
        rows: list[Friendship],
    ) -> list[FriendSummaryResponse]:
        result: list[FriendSummaryResponse] = []
        for friendship in rows:
            friend = await SocialDao.get_other_friend(
                session,
                friendship,
                current_user_id,
            )
            if friend is not None:
                result.append(
                    FriendSummaryResponse(
                        id=friend.id,
                        username=friend.username,
                        tag=friend.tag,
                    ),
                )
        return result

    return FriendsListResponse(
        friends=friends,
        requests=await serialize_requests(incoming),
        sent_requests=await serialize_requests(outgoing),
        categories=[
            FriendCategoryResponse(
                id=category.id,
                name=category.name,
                color=category.color,
                is_default=category.is_default,
            )
            for category in categories
        ],
    )


@social_router.post("/friends/categories", status_code=status.HTTP_201_CREATED)
async def create_friend_category(
    data: CategoryCreate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> FriendCategoryResponse:
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Category name cannot be empty")
    try:
        category = await SocialDao.add_friend_category(
            session,
            owner_id=current_user_id,
            name=name,
            color=data.color,
        )
    except DuplicateResourceError as error:
        raise HTTPException(status_code=409, detail="Category already exists") from error
    return FriendCategoryResponse(
        id=category.id,
        name=category.name,
        color=category.color,
        is_default=category.is_default,
    )


@social_router.post("/friends/{friend_id}/request", status_code=status.HTTP_200_OK)
async def request_friendship(
    friend_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> SocialStatusResponse:
    if friend_id == current_user_id:
        raise HTTPException(status_code=400, detail="You cannot add yourself")
    if await SocialDao.get_user(session, friend_id) is None:
        raise HTTPException(status_code=404, detail="User not found")

    low_id, high_id = sorted((current_user_id, friend_id), key=str)
    friendship = await SocialDao.get_friendship(session, low_id, high_id)
    if friendship is None:
        friendship = await SocialDao.add_friendship(
            session,
            user_low_id=low_id,
            user_high_id=high_id,
            requested_by_id=current_user_id,
        )
    elif friendship.status == "accepted":
        return SocialStatusResponse(status="accepted")
    elif friendship.status == "pending":
        if friendship.requested_by_id != current_user_id:
            await SocialDao.update_friendship(
                session,
                friendship.id,
                status="accepted",
            )
            return SocialStatusResponse(status="accepted")
        return SocialStatusResponse(status="pending")
    else:
        await SocialDao.update_friendship(
            session,
            friendship.id,
            status="pending",
            requested_by_id=current_user_id,
        )
    return SocialStatusResponse(status=friendship.status)


@social_router.post("/friends/{friend_id}/accept")
async def accept_friendship(
    friend_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> SocialStatusResponse:
    low_id, high_id = sorted((current_user_id, friend_id), key=str)
    friendship = await SocialDao.get_friendship(
        session,
        low_id,
        high_id,
        status="pending",
        incoming_to_id=current_user_id,
    )
    if friendship is None:
        raise HTTPException(status_code=404, detail="Friend request not found")
    await SocialDao.update_friendship(session, friendship.id, status="accepted")
    return SocialStatusResponse(status="accepted")


@social_router.patch("/friends/{friend_id}/category")
async def set_friend_category(
    friend_id: uuid.UUID,
    data: FriendCategoryUpdate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> SocialStatusResponse:
    low_id, high_id = sorted((current_user_id, friend_id), key=str)
    friendship = await SocialDao.get_friendship(
        session,
        low_id,
        high_id,
        status="accepted",
    )
    if friendship is None:
        raise HTTPException(status_code=404, detail="Friend not found")
    category_updated = await SocialDao.set_friend_category(
        session,
        friendship.id,
        current_user_id,
        data.category_id,
    )
    if not category_updated:
        raise HTTPException(status_code=404, detail="Category not found")
    return SocialStatusResponse(status="success")


@social_router.get("/chat-folders")
async def list_chat_folders(
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> ChatFoldersListResponse:
    folders = await SocialDao.list_chat_folders(session, current_user_id)
    return ChatFoldersListResponse(
        folders=[
            ChatFolderResponse(
                id=folder.id,
                name=folder.name,
                color=folder.color,
                is_default=folder.is_default,
                chat_ids=chat_ids,
            )
            for folder, chat_ids in folders
        ],
    )


@social_router.post("/chat-folders", status_code=status.HTTP_201_CREATED)
async def create_chat_folder(
    data: CategoryCreate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> ChatFolderResponse:
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Folder name cannot be empty")
    try:
        folder = await SocialDao.add_chat_folder(
            session,
            owner_id=current_user_id,
            name=name,
            color=data.color,
        )
    except DuplicateResourceError as error:
        raise HTTPException(status_code=409, detail="Folder already exists") from error
    return ChatFolderResponse(
        id=folder.id,
        name=folder.name,
        color=folder.color,
        is_default=folder.is_default,
        chat_ids=[],
    )


@social_router.patch("/chats/{chat_id}/folder")
async def set_chat_folder(
    chat_id: uuid.UUID,
    data: ChatFolderUpdate,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
) -> SocialStatusResponse:
    if not await SocialDao.is_chat_member(session, chat_id, current_user_id):
        raise HTTPException(status_code=404, detail="Chat not found")
    await SocialDao.clear_chat_folder(session, chat_id, current_user_id)
    if data.folder_id is not None:
        folder = await SocialDao.get_owned_chat_folder(
            session,
            data.folder_id,
            current_user_id,
        )
        if folder is None:
            raise HTTPException(status_code=404, detail="Folder not found")
        await SocialDao.assign_chat_folder(
            session,
            folder.id,
            chat_id,
            current_user_id,
        )
    return SocialStatusResponse(status="success")
