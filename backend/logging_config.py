import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path


def configure_logging() -> None:
    """Write application and database diagnostics to separate log files."""
    log_dir = Path(os.getenv("LOG_DIR", str(Path(__file__).resolve().parent / "logs")))
    log_dir.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter("%(asctime)s %(levelname)s [%(name)s] %(message)s")
    backend_handler = logging.FileHandler(log_dir / "backend.log", encoding="utf-8")
    backend_handler.setFormatter(formatter)

    root_logger = logging.getLogger()
    root_logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    if not any(
        isinstance(handler, logging.FileHandler)
        and getattr(handler, "baseFilename", "").endswith("backend.log")
        for handler in root_logger.handlers
    ):
        root_logger.addHandler(backend_handler)

    database_handler = RotatingFileHandler(
        log_dir / "database-client.log",
        maxBytes=10 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    database_handler.setFormatter(formatter)
    sqlalchemy_logger = logging.getLogger("sqlalchemy")
    sqlalchemy_logger.setLevel(logging.WARNING)
    sqlalchemy_logger.propagate = False
    if not any(
        isinstance(handler, RotatingFileHandler)
        and getattr(handler, "baseFilename", "").endswith("database-client.log")
        for handler in sqlalchemy_logger.handlers
    ):
        sqlalchemy_logger.addHandler(database_handler)

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        server_logger = logging.getLogger(logger_name)
        server_logger.handlers.clear()
        server_logger.propagate = True
