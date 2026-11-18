import os
from pathlib import Path
import subprocess
import sys


async def test_start_app(api_client):
    response = await api_client.get("/docs")

    assert response.status_code == 200


def test_production_logging_uses_stdout_without_log_directory() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "import logging; from logging_config import configure_logging; "
            "configure_logging(); logging.info('application started')",
        ],
        cwd=Path(__file__).resolve().parents[2],
        env={
            **os.environ,
            "LOG_DIR": str(Path(__file__).resolve()),
            "LOG_LEVEL": "INFO",
            "LOG_TO_STDOUT": "1",
        },
        capture_output=True,
        text=True,
        check=True,
    )

    assert "application started" in result.stdout
