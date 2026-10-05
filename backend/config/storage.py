from pydantic_settings import BaseSettings, SettingsConfigDict


class YandexStorage(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    YANDEX_CLOUD_KEY_ID: str
    YANDEX_CLOUD_KEY: str
    BUCKET_NAME: str
    ENDPOINT_URL: str = "https://storage.yandexcloud.net"


yandex_storage = YandexStorage()
