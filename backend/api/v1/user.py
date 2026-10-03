from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from config import RouteTags
from db.dao.user_dao import UserDao
from db.database import get_session
from schemas.user import UserRead, UserUpdate

user_router = APIRouter(prefix="/api/v1/users", tags=[RouteTags.USERS])


def get_user():
    return None


@user_router.get("/me")
async def get_me(
    session: AsyncSession = Depends(get_session),
    user=Depends(get_user),
) -> UserRead:
    return await UserDao.get_by_id(session=session, target_id=user.id)


@user_router.patch("/me")
async def update_me(
    update_user: UserUpdate,
    session: AsyncSession = Depends(get_session),
    current_user=Depends(get_user),
) -> UserRead:
    user: UserRead = await UserDao.update(
        session=session, target_id=current_user.id, data=update_user.model_dump(),
    )
    return user
