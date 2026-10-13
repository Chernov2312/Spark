import uuid

from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_id_current_user
from db.dao.chat_dao import ChatDao
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
    user = await UserDao.get_user_with_chats(session=session, target_id=user_id)
    return GetChatsResponse(chats=user.chats)


@chat_router.post("/chats", status_code=status.HTTP_201_CREATED)
async def post_new_chat(
    data: NewChatRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> NewChatResponse:
    owner_id = user_id
    users_in_chat_ids = [user_id]
    for id in data.invited_user_ids:
        users_in_chat_ids.append(id)

    new_chat = await ChatDao.add(
        session,
        {"owner_id": owner_id, "title": data.title, "description": data.description},
    )

    await ChatDao.add_users_to_chat(
        session=session,
        chat_id=new_chat.id,
        new_user_ids=users_in_chat_ids,
    )

    await session.commit()
    await session.flush()

    return NewChatResponse(
        id=str(new_chat.id),
        owner_id=str(new_chat.owner_id),
        title=new_chat.title,
        description=new_chat.description,
        users_count=len(users_in_chat_ids),
        invited_user_ids=[str(uid) for uid in users_in_chat_ids],
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

    await session.commit()
    await session.refresh(cur_chat)
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
