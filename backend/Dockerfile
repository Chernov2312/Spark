FROM python:3.13-slim

LABEL maintainer="Vladimir Max"
LABEL description="Spark"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends bash ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements/ ./requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

COPY . .
COPY ./entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN useradd -m appuser && chown -R appuser:appuser /app /entrypoint.sh
USER appuser