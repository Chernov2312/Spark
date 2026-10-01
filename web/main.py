from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI

from db.database import create_tables


@asynccontextmanager
async def lifespan(app: FastAPI):
    await create_tables()
    yield


def create_app() -> FastAPI:
    application = FastAPI(
        title="Spark",
        lifespan=lifespan,
    )

    return application


app = create_app()

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
