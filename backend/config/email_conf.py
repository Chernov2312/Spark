from functools import lru_cache

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Email(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )
    FROM_EMAIL: str
    LOGIN_EMAIL: str
    PASSWORD_EMAIL: SecretStr
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 465


@lru_cache
def get_email_settings() -> Email:
    return Email()
