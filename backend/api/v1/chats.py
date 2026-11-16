from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.dependencies import get_redis
from core.security import get_id_current_user
from core.storage import S3Storage
from db.dao.chat_dao import ChatDao
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models import Chat
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.chat_state import (
    ChatMemberResponse,
    ChatMemberRoleUpdate,
    MarkChatReadRequest,
    MarkChatReadResponse,
)
from schemas.chats import (
    AddUserToChatResponse,
    ChatAddUserRequest,
    ChatResponse,
    GetChatsResponse,
    NewChatRequest,
    NewChatResponse,
    PatchChatRequest,
)
from schemas.responses import ChatMemberRoleResponse
from schemas.websockets import WsEvent

chat_router = APIRouter(prefix="/api/v1", tags=[RouteTags.CHAT])


@chat_router.get("/chats/{chat_id}/members")
async def get_chat_members(
    chat_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> list[ChatMemberResponse]:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None or not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=404, detail="Chat not found")
    roles = await ChatDao.get_member_roles(session, chat_id)
    read_states = await ChatDao.get_read_states(session, chat_id)
    return [
        ChatMemberResponse(
            id=member.id,
            username=member.username,
            tag=member.tag,
            role=roles.get(member.id, "member"),
            last_read_message_id=read_states.get(member.id),
        )
        for member in chat.users
    ]


@chat_router.put("/chats/{chat_id}/members/{member_id}/role")
async def set_chat_member_role(
    chat_id: uuid.UUID,
    member_id: uuid.UUID,
    data: ChatMemberRoleUpdate,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> ChatMemberRoleResponse:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    if chat.owner_id != user_id:
        raise HTTPException(
            status_code=403, detail="Only the chat owner can change roles"
        )
    role = data.role
    if member_id == chat.owner_id:
        raise HTTPException(status_code=422, detail="Role must be member or moderator")
    if not await ChatDao.set_member_role(session, chat_id, member_id, role):
        raise HTTPException(status_code=404, detail="Member not found")
    return ChatMemberRoleResponse(role=role)


@chat_router.post("/chats/{chat_id}/read")
async def mark_chat_read(
    chat_id: uuid.UUID,
    data: MarkChatReadRequest,
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
    redis: Redis = Depends(get_redis),
) -> MarkChatReadResponse:
    chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
    if chat is None or not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=404, detail="Chat not found")
    message_id = data.message_id
    if message_id and not await ChatDao.is_message_in_chat(
        session,
        chat_id,
        message_id,
    ):
        raise HTTPException(
            status_code=422, detail="Message does not belong to this chat"
        )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    await ChatDao.mark_read(session, chat_id, user_id, message_id, now)
    await RedisDao.publish_chat_event(
        redis,
        chat_id,
        WsEvent(
            event="user:read",
            data={
                "chat_id": chat_id,
                "user_id": user_id,
                "last_read_message_id": message_id,
            },
        ).model_dump_json(),
    )
    return MarkChatReadResponse(last_read_message_id=message_id)


@chat_router.get("/chats", status_code=status.HTTP_200_OK)
async def get_chats(
    session: AsyncSession = Depends(get_session),
    user_id: uuid.UUID = Depends(get_id_current_user),
) -> GetChatsResponse:
    s3 = S3Storage()
    user = await UserDao.get_user_with_chats(session=session, target_id=user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
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
    s3 = S3Storage()
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
    await ChatDao.set_owner_role(session, new_chat.id, user_id)
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
    chat_id: uuid.UUID,
    data: PatchChatRequest,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
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
    updated_chat = await ChatDao.update_chat_fields(
        session,
        cur_chat.id,
        title=data.title,
        description=data.description,
    )
    if updated_chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return updated_chat


@chat_router.post("/chats/{chat_id}/users")
async def add_users_in_chat(
    data: ChatAddUserRequest,
    chat_id: uuid.UUID,
    session: AsyncSession = Depends(get_session),
    current_user_id: uuid.UUID = Depends(get_id_current_user),
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

    return AddUserToChatResponse(status="success")
