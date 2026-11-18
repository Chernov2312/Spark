from fastapi import APIRouter

from api.v1.ai import ai_router
from api.v1.auth import auth_router
from api.v1.chats import chat_router
from api.v1.core import core_router
from api.v1.media import attachment_router
from api.v1.message import message_router
from api.v1.polls import poll_router
from api.v1.reactions import reactions_router
from api.v1.social import social_router
from api.v1.user import user_router
from api.v1.websockets.chat_typing import ws_router

router = APIRouter()

router.include_router(core_router)
router.include_router(auth_router)
router.include_router(user_router)
router.include_router(social_router)
router.include_router(chat_router)
router.include_router(message_router)
router.include_router(poll_router)
router.include_router(reactions_router)
router.include_router(attachment_router)
router.include_router(ai_router)
router.include_router(ws_router)
