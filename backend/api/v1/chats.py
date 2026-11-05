import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.chat_dao import Chat, ChatDao
from db.dao.user_dao import UserDao
from db.database import get_session
from schemas.chats import (
    AddUserToChatResponse,
    ChatAddUserRequest,
    ChatResponse,
    GetChatsResponse,
    NewChatRequest,
    NewChatResponse,
    PatchChatRequest,
)

chat_router = APIRouter(prefix="/api/v1", tags=[RouteTags.CHAT])


@chat_router.get("/chats", status_code=status.HTTP_200_OK)
async def get_chats(
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> GetChatsResponse:
    s3 = S3Storage()
    user = await UserDao.get_user_with_chats(session=session, target_id=user_id)
    chats = []
    for chat in user.chats:
        avatars = []
        for avatar in chat.avatars:
            avatars.append(await s3.get_temporary_url(avatar.file_key))
        chat_model = ChatResponse.model_validate(chat)
        chat_model.avatar_urls = avatars.copy()
        chats.append(chat_model)
    return GetChatsResponse(chats=chats)


@chat_router.post("/chats", status_code=status.HTTP_201_CREATED)
async def post_new_chat(
    data: NewChatRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> NewChatResponse:
    s3 = S3Storage
    owner_id = user_id
    if data.id is None:
        new_chat: Chat = await ChatDao.add(
            session,
            {"owner_id": owner_id, "title": data.title, "description": data.description},
        )
    else:
        new_chat: Chat = await ChatDao.add(
            session,
            {
                "id": data.id,
                "owner_id": owner_id,
                "title": data.title,
                "description": data.description,
            },
        )

    await ChatDao.add_users_to_chat(
        session=session,
        chat_id=new_chat.id,
        new_user_ids=data.invited_user_ids + [user_id],
    )
    avatars = [(await s3.get_temporary_url(i.avatar_url)) for i in data.avatar_urls]
    return NewChatResponse(
        id=str(new_chat.id),
        owner_id=str(new_chat.owner_id),
        title=new_chat.title,
        description=new_chat.description,
        avater_urls=avatars,
        users_count=len(data.invited_user_ids) + 1,
        invited_user_ids=data.invited_user_ids + [user_id],
        created_at=new_chat.created_at,
    )


@chat_router.patch("/chats/{chat_id}", status_code=status.HTTP_200_OK)
async def update_chat(
    chat_id: str,
    data: PatchChatRequest,
    session: AsyncSession = Depends(get_session),
    current_user_id: str = Depends(get_id_current_user),
) -> ChatResponse:
    cur_chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)

    if cur_chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )

    if current_user_id != cur_chat.owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to edit this chat",
        )
    if data.description is not None:
        cur_chat.description = data.description
    if data.title is not None:
        cur_chat.title = data.title

    return cur_chat


@chat_router.post("/chats/{chat_id}/users")
async def add_users_in_chat(
    data: ChatAddUserRequest,
    chat_id: str,
    session: AsyncSession = Depends(get_session),
    current_user_id: str = Depends(get_id_current_user),
) -> AddUserToChatResponse:
    cur_chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)

    if cur_chat is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Chat not found",
        )

    if current_user_id != cur_chat.owner_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to edit this chat",
        )
    if data.user_ids is not None:
        await ChatDao.add_users_to_chat(
            session=session,
            chat_id=chat_id,
            new_user_ids=data.user_ids,
        )

    await session.commit()
    await session.refresh(cur_chat)
    return AddUserToChatResponse(status="success")
