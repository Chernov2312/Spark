from datetime import datetime, timezone
import uuid

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from core.message_actions import ensure_read_target
from core.profile_privacy import can_view_profile_field
from core.storage import S3Storage
from db.dao.chat_dao import ChatDao
from db.dao.social_dao import SocialDao
from infrastructure.redis.client import Redis
from infrastructure.redis.redis_dao import RedisDao
from schemas.chat_state import ChatMemberResponse, MarkChatReadResponse
from schemas.websockets import WsEvent


async def mark_chat_read(
    session: AsyncSession,
    redis: Redis,
    chat_id: uuid.UUID,
    user_id: uuid.UUID,
    message_id: uuid.UUID | None,
) -> MarkChatReadResponse:
    chat = await ChatDao.get_chat_with_users(session, chat_id)
    if chat is None or not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=404, detail="Chat not found")
    if message_id is not None and not await ensure_read_target(
        session, redis, chat_id, message_id
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


async def list_chat_members(
    session: AsyncSession,
    chat_id: uuid.UUID,
    user_id: uuid.UUID,
) -> list[ChatMemberResponse]:
    chat = await ChatDao.get_chat_with_users(session, chat_id, include_avatars=True)
    if chat is None or not any(member.id == user_id for member in chat.users):
        raise HTTPException(status_code=404, detail="Chat not found")
    viewer = next(member for member in chat.users if member.id == user_id)
    roles = await ChatDao.get_member_roles(session, chat_id)
    read_states = await ChatDao.get_read_states(session, chat_id)
    storage = S3Storage()
    members = []
    for member in chat.users:
        viewer_is_friend = False
        if member.id != user_id:
            user_low_id, user_high_id = sorted((member.id, user_id))
            viewer_is_friend = (
                await SocialDao.get_friendship(
                    session,
                    user_low_id,
                    user_high_id,
                    status="accepted",
                )
                is not None
            )
        visible = {
            field: can_view_profile_field(
                member,
                user_id,
                viewer.tag,
                field,
                viewer_is_friend=viewer_is_friend,
            )
            for field in ("avatar", "bio", "birth_date")
        }
        avatar_urls = []
        if visible["avatar"]:
            avatar_urls = [
                await storage.get_temporary_url(avatar.file_key)
                for avatar in sorted(
                    member.avatars, key=lambda item: (item.created_at, item.id)
                )
                if avatar.file_key
            ]
        members.append(
            ChatMemberResponse(
                id=member.id,
                username=member.username,
                tag=member.tag,
                role="owner"
                if member.id == chat.owner_id
                else roles.get(member.id, "member"),
                last_read_message_id=read_states.get(member.id),
                avatar_urls=avatar_urls,
                bio=member.bio if visible["bio"] else None,
                birth_date=member.birth_date if visible["birth_date"] else None,
                created_at=member.created_at,
            )
        )
    return sorted(
        members,
        key=lambda member: (
            {"owner": 0, "moderator": 1, "member": 2}[member.role],
            member.username.casefold(),
            str(member.id),
        ),
    )
