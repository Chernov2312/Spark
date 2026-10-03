from fastapi import APIRouter, Request

from db.dao.user_dao import UserDao
from schemas.auth import UserRegister, Vernul

auth = APIRouter()


@auth.get("/register")
async def register(request: Request, user: UserRegister) -> Vernul:
    return Vernul("govno")
