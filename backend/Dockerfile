FROM python:3.13-slim

LABEL maintainer="Vladimir Max Artem"
LABEL description="Spark"

WORKDIR /app

RUN apt-get update && apt-get upgrade -y && apt-get install -y bash ffmpeg

COPY requirements/ ./requirements/
RUN pip install --no-cache-dir -r requirements/prod.txt
COPY . .

COPY ./entrypoint.sh /entrypoint.sh
