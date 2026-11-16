from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from logging_config import configure_logging

from api.v1.router import router
from config import get_settings
from infrastructure.redis.client import close_redis_client, create_redis_client

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> None:
    logger.info("Starting Spark backend")
    app.state.redis = create_redis_client(str(get_settings().redis_url))
    yield
    await close_redis_client(app.state.redis)
    logger.info("Stopped Spark backend")


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
app.include_router(router)
