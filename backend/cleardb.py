import argparse
import asyncio
from pathlib import Path
import sys

from asyncpg import PostgresError
from dotenv import load_dotenv
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from config import get_settings


def database_address(host: str, port: int, *, in_docker: bool) -> tuple[str, int]:
    # Compose publishes postgres:5432 as localhost:5433 on the host.
    if host == "postgres" and not in_docker:
        return "127.0.0.1", 5433
    return host, port


async def main(host: str | None = None, port: int | None = None) -> int:
    from db.dao.user_dao import UserDao

    settings = get_settings()
    default_host, default_port = database_address(
        settings.POSTGRES_HOST,
        settings.POSTGRES_PORT,
        in_docker=Path("/.dockerenv").exists(),
    )
    settings = settings.model_copy(
        update={
            "POSTGRES_HOST": host if host is not None else default_host,
            "POSTGRES_PORT": port if port is not None else default_port,
        }
    )
    engine = create_async_engine(settings.db_url, connect_args={"timeout": 5})
    try:
        sessions = async_sessionmaker(engine, expire_on_commit=False)
        async with sessions.begin() as session:
            deleted = await UserDao.delete_all_with_messages(session)
        print(f"Удалено пользователей: {deleted}")
        return 0
    except (OSError, SQLAlchemyError, PostgresError) as error:
        print(
            f"Не удалось очистить БД ({type(error).__name__}). "
            f"Проверьте доступность PostgreSQL по адресу "
            f"{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}, "
            "учётные данные и применение миграций. "
            "Изменения транзакции отменены.",
            file=sys.stderr,
        )
        return 1
    finally:
        await engine.dispose()


def cli() -> int:
    parser = argparse.ArgumentParser(
        description="Удалить всех пользователей, сообщения и связанные записи из БД."
    )
    parser.add_argument("--host", help="Адрес PostgreSQL вместо значения из .env")
    parser.add_argument("--port", type=int, help="Порт PostgreSQL")
    args = parser.parse_args()
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    return asyncio.run(main(args.host, args.port))


if __name__ == "__main__":
    raise SystemExit(cli())
