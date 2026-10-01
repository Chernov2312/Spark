from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )
    POSTGRES_HOST: str = "localhost"
    POSTGRES_PORT: str = 5432
    POSTGRES_DB: str
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str

    @property
    def db_url(self):
        return (
            f"postgresql+asyncpg://{self.POSTGRES_USER}"
            f":{self.POSTGRES_PASSWORD}"
            f"@{self.POSTGRES_HOST}"
            f":{self.POSTGRES_PORT}"
            f"/{self.POSTGRES_DB}"
        )


settings = Settings()
