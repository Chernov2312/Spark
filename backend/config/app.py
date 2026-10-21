import redis.asyncio as aioredis
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: str = "5432"
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str

    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    VERIFICATION_TOKEN_EXPIRE_DAYS: int = 1

    REDIS_PASSWORD: str
    REDIS_USER: str
    REDIS_USER_PASSWORD: str

    @property
    def db_url(self):
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}"
            f":{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}"
            f":{self.POSTGRES_PORT}"
            f"/{self.POSTGRES_DB}"
        )

    @property
    def get_redis_client(self) -> aioredis.Redis:
        pool = aioredis.ConnectionPool(
            host="redis",
            port=6379,
            username=self.REDIS_USER,
            password=self.REDIS_USER_PASSWORD,
            decode_responses=True,
        )

        return aioredis.Redis(connection_pool=pool)


settings = Settings()
