from contextlib import asynccontextmanager

import redis.asyncio as aioredis
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.v1.ai import ai_router
from api.v1.auth import auth_router
from api.v1.chats import chat_router
from api.v1.core import core_router
from api.v1.media import attachment_router
from api.v1.message import message_router
from api.v1.reactions import reactions_router
from api.v1.user import user_router
from api.v1.websockets.chat_typing import ws_router
from config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.redis = aioredis.Redis.from_url(
        settings.redis_url,
        decode_responses=True,
    )
    yield
    await app.state.redis.aclose()


def create_app() -> FastAPI:
    application = FastAPI(
        title="Spark",
        lifespan=lifespan,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5174", "http://127.0.0.1:5174", "*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    return application


app = create_app()
app.include_router(core_router)
app.include_router(auth_router)
app.include_router(user_router)
app.include_router(chat_router)
app.include_router(message_router)
app.include_router(reactions_router)
app.include_router(attachment_router)
app.include_router(ai_router)
app.include_router(ws_router)
