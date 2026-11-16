from functools import lru_cache

from pydantic import PostgresDsn, RedisDsn, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: int = 5432
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: SecretStr

    SECRET_KEY: SecretStr
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    VERIFICATION_TOKEN_EXPIRE_DAYS: int = 1
    PASSWORD_RESET_TOKEN_EXPIRE_MINUTES: int = 30

    REDIS_HOST: str = "redis"
    REDIS_PASSWORD: SecretStr
    REDIS_USER: str
    REDIS_USER_PASSWORD: SecretStr
    REDIS_PORT: int = 6379

    API_BASE_URL: str = "http://localhost:8001"
    FRONTEND_BASE_URL: str = "http://localhost:5174/"
    APP_BASE_URL: str = "http://localhost:5174/"

    @property
    def db_url(self) -> str:
        return str(
            PostgresDsn.build(
                scheme="postgresql+asyncpg",
                username=self.POSTGRES_USER,
                password=self.POSTGRES_PASSWORD.get_secret_value(),
                host=self.POSTGRES_HOST,
                port=self.POSTGRES_PORT,
                path=self.POSTGRES_DB,
            ),
        )

    @property
    def redis_url(self) -> str:
        return str(
            RedisDsn.build(
                scheme="redis",
                username=self.REDIS_USER,
                password=self.REDIS_USER_PASSWORD.get_secret_value(),
                host=self.REDIS_HOST,
                port=self.REDIS_PORT,
                path="0",
            ),
        )


@lru_cache
def get_settings() -> Settings:
    return Settings()
