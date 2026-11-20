FROM python:3.13-slim

LABEL maintainer="Vladimir Max"
LABEL description="Spark"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LOG_DIR=/logs

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && \
    apt-get install -y --no-install-recommends bash ffmpeg && \
    rm -rf /var/lib/apt/lists/*

COPY requirements/ ./requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt

COPY . .
COPY ./entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

RUN groupadd --gid 65532 appuser && useradd --uid 65532 --gid 65532 -m appuser && \
    install -d -o 65532 -g 65532 /logs /home/appuser/.cache/whisper
ENV HOME=/home/appuser
USER 65532:65532
