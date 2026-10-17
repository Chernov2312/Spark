from pydantic_settings import BaseSettings, SettingsConfigDict


class Email(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )
    FROM_EMAIL: str
    LOGIN_EMAIL: str
    PASSWORD_EMAIL: str


email = Email()
