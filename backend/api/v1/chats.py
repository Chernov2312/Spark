from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from core.security import get_current_user
from db.dao.chat_dao import ChatDao
from db.dao.user_dao import UserDao
from db.database import get_session
from db.models.user import User
from schemas.chats import NewChatRequest

chat_router = APIRouter(prefix="/api/v1", tags=[RouteTags.CHAT])


@chat_router.get("/chats", status_code=status.HTTP_200_OK)
async def get_chats(
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
):
    user = await UserDao.get_user_with_chats(session=session, target_id=user.id)
    return JSONResponse(user.chats)


@chat_router.post("/chats/{chat_id}", status_code=status.HTTP_201_CREATED)
async def post_new_chat(
    data: NewChatRequest,
    session: AsyncSession = Depends(get_session),
    user: User = Depends(get_current_user),
) -> None:
    users_in_chat_ids = [user.id]
    for id in data.invited_user_ids:
        users_in_chat_ids.append(id)

    new_chat = await ChatDao.add(
        session,
        {"owner_id": user.id, "title": data.title, "description": data.description},
    )

    await ChatDao.add_users_to_chat(
        session=session,
        chat_id=new_chat.id,
        new_user_ids=users_in_chat_ids,
    )

    return {
        "id": str(new_chat.id),
        "owner_id": str(new_chat.owner_id),
        "title": new_chat.title,
        "description": new_chat.description,
        "users_count": len(new_chat.users),
    }
