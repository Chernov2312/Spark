#!/bin/bash
mkdir -p /logs
alembic upgrade head >> /logs/backend.log 2>&1
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
