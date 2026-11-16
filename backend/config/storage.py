from enum import StrEnum
from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class YandexStorage(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    YANDEX_CLOUD_KEY_ID: str
    YANDEX_CLOUD_KEY: SecretStr
    BUCKET_NAME: str
    ENDPOINT_URL: str = "https://storage.yandexcloud.net"


class StorageCategory(StrEnum):
    USER_AVATAR = "user_avatar"
    CHAT_AVATAR = "chat_avatar"
    USER_MESSAGE = "user_message"


class StorageClientMethod(StrEnum):
    GET = "get_object"
    PUT = "put_object"


@lru_cache
def get_storage_settings() -> YandexStorage:
    return YandexStorage()
