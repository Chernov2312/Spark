#!/bin/bash
set -e
alembic upgrade head
exec uvicorn main:app --workers 4 --host 0.0.0.0 --port 8000 "$@"
