from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
import redis.asyncio as aioredis
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.dependencies import get_redis
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.chat_dao import Chat, ChatDao
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models import ChatReadState, Message, user_chat
from schemas.chats import (
    AddUserToChatResponse,
    ChatAddUserRequest,
    ChatResponse,
    GetChatsResponse,
    NewChatRequest,
    NewChatResponse,
    PatchChatRequest,
)
from schemas.websockets import WsEvent

chat_router = APIRouter(prefix="/api/v1", tags=[RouteTags.CHAT])


@chat_router.get("/chats/{chat_id}/members")
async def get_chat_members(
    chat_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> list[dict]:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None or not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=404, detail="Chat not found")
    role_rows = await session.execute(select(user_chat.c.user_id, user_chat.c.role).where(user_chat.c.chat_id == chat_id))
    roles = dict(role_rows.all())
    read_rows = await session.execute(select(ChatReadState.user_id, ChatReadState.last_read_message_id).where(ChatReadState.chat_id == chat_id))
    read_states = dict(read_rows.all())
    return [{"id": str(member.id), "username": member.username, "tag": member.tag, "role": roles.get(member.id, "member"), "last_read_message_id": str(read_states[member.id]) if read_states.get(member.id) else None} for member in chat.users]


@chat_router.put("/chats/{chat_id}/members/{member_id}/role")
async def set_chat_member_role(
    chat_id: uuid.UUID,
    member_id: uuid.UUID,
    data: dict,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> dict[str, str]:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    if chat.owner_id != user_id:
        raise HTTPException(status_code=403, detail="Only the chat owner can change roles")
    role = data.get("role")
    if role not in {"member", "moderator"} or member_id == chat.owner_id:
        raise HTTPException(status_code=422, detail="Role must be member or moderator")
    result = await session.execute(update(user_chat).where(user_chat.c.chat_id == chat_id, user_chat.c.user_id == member_id).values(role=role))
    if result.rowcount != 1:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"role": role}


@chat_router.post("/chats/{chat_id}/read")
async def mark_chat_read(
    chat_id: uuid.UUID,
    data: dict,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: aioredis.Redis = Depends(get_redis),
) -> dict[str, str | None]:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None or not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=404, detail="Chat not found")
    raw_message_id = data.get("message_id")
    message_id = uuid.UUID(raw_message_id) if raw_message_id else None
    if message_id and await session.scalar(select(Message.id).where(Message.id == message_id, Message.chat_id == chat_id)) is None:
        raise HTTPException(status_code=422, detail="Message does not belong to this chat")
    state = await session.scalar(select(ChatReadState).where(ChatReadState.chat_id == chat_id, ChatReadState.user_id == user_id))
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if state is None:
        state = ChatReadState(chat_id=chat_id, user_id=user_id, last_read_message_id=message_id, last_read_at=now)
        session.add(state)
    else:
        state.last_read_message_id = message_id
        state.last_read_at = now
    await redis.publish(
        f"chat:{chat_id}",
        WsEvent(event="user:read", data={"chat_id": chat_id, "user_id": user_id, "last_read_message_id": message_id}).model_dump_json(),
    )
    return {"last_read_message_id": str(message_id) if message_id else None}


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
    missing_user_ids = await ChatDao.get_missing_user_ids(
        session=session,
        user_ids=data.invited_user_ids,
    )
    if missing_user_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more invited users do not exist",
        )

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
    await session.execute(
        update(user_chat)
        .where(user_chat.c.chat_id == new_chat.id, user_chat.c.user_id == user_id)
        .values(role="owner"),
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
        missing_user_ids = await ChatDao.get_missing_user_ids(
            session=session,
            user_ids=data.user_ids,
        )
        if missing_user_ids:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="One or more invited users do not exist",
            )
        await ChatDao.add_users_to_chat(
            session=session,
            chat_id=chat_id,
            new_user_ids=data.user_ids,
        )

    await session.commit()
    await session.refresh(cur_chat)
    return AddUserToChatResponse(status="success")
