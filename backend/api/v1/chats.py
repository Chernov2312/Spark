# from fastapi import (
#     APIRouter,
#     Depends,
#     HTTPException,
#     Response,
#     UploadFile,
#     status,
# )
# from sqlalchemy.ext.asyncio import AsyncSession

# from config import RouteTags
# from core.security import get_current_user
# from core.storage import S3Storage
# from db.dao.image_dao import ImageDao
# from db.dao.user_dao import UserDao
# from db.database import get_session
# from schemas.user import Avatar, UserRead, UserUpdate

# chat_router = APIRouter(prefix="api/v1", tags=[RouteTags.CHAT])

# @chat_router.get("/chats")
# async def get_chats(
#     session: AsyncSession = Depends(get_session),
#     user=Depends(get_current_user),
# ):
