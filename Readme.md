# Spark

Spark — веб-мессенджер с REST API и WebSocket-соединениями. Backend работает на FastAPI, PostgreSQL хранит данные, Redis передаёт события чатов и обслуживает очередь сообщений, Celery запускает фоновые задачи.

## Возможности

- Регистрация, подтверждение почты и вход по JWT.
- Личные и групповые чаты, профили, аватары и статусы набора текста.
- Сообщения с файлами, изображения в чате и реакции.
- Поиск по пользователям и создание групповых чатов.
- Форматирование сообщений, краткое содержание переписки и переписывание текста через Ollama с OpenAI-совместимым клиентом.
- Распознавание голосовых вложений через Whisper по запросу пользователя.
- Загрузка файлов в S3-совместимое хранилище Yandex Cloud.

## Требования

- Docker и Docker Compose. На Windows и macOS можно использовать Docker Desktop.
- Ollama запускается в Docker. Значение `OPENAI_API_KEY=ollama` служит заглушкой для SDK при работе с локальной Ollama.
- Backend image использует Python 3.13 и FFmpeg для подготовки аудио к Whisper.

## Запуск через Docker Compose

Все команды выполняются из корня проекта.

### Локальная разработка

1. Для новой установки создайте `.env` из шаблона.

   ```powershell
   Copy-Item .env.example .env
   ```

   На macOS/Linux:

   ```bash
   cp .env.example .env
   ```

2. Для профиля `dev` используйте `API_BASE_URL=http://localhost:8001` и `FRONTEND_BASE_URL=http://localhost:5174`. Адреса `postgres:5432` и `redis:6379` в `.env` нужны сервисам внутри сети Compose. Приложение обращается к локальной модели `qwen3:0.6b` по `OPENAI_BASE_URL=http://ollama:11434/v1`. Для отправки писем и работы с объектным хранилищем заполните параметры SMTP и Yandex Cloud в `.env`.

3. Соберите и запустите приложение:

   ```bash
   docker compose --profile dev up --build
   ```

   Compose запускает Ollama и загружает выбранную модель, затем запускает PostgreSQL, Redis, FastAPI, Celery worker и beat, а также frontend. Backend обращается к локальной модели через OpenAI-совместимый API и применяет миграции Alembic.

Откройте:

- Frontend: <http://localhost:5174>
- API: <http://localhost:8001>
- Swagger UI: <http://localhost:8001/docs>
- Health check: <http://localhost:8001/health>
- PostgreSQL: `localhost:5433`
- Redis: `localhost:6380`
- Ollama API: <http://localhost:11434>

Чтобы остановить сервисы и сохранить данные, выполните `docker compose --profile dev down`. Для полной очистки также удалите Docker volumes `spark_postgres_data` и `spark_ollama_data`, а также локальную папку `redisdata`.

### Запуск на сервере с HTTPS

На сервере создайте `.env` из `.env.example` для новой установки или отредактируйте действующий `.env`. Укажите домен и относительный адрес API.

```dotenv
API_BASE_URL=/api/v1
FRONTEND_BASE_URL=https://sparkwork.dpdns.org
```

Compose передаёт `API_BASE_URL` во frontend как `VITE_API_URL`. При значении `/api/v1` REST и WebSocket используют домен открытой страницы. Backend использует `FRONTEND_BASE_URL` в ссылках подтверждения почты и сброса пароля.

В Git хранятся `.env.example` с примерами значений и `.env.test` с тестовыми настройками. Рабочие пароли и ключи храните в исключённом из Git файле `.env` на сервере. Для новой установки задайте отдельные значения `SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` и `REDIS_USER_PASSWORD`. Для генерации каждого значения можно использовать `openssl rand -hex 32`. Для существующей БД укажите пароль действующей роли PostgreSQL. Изменение `POSTGRES_PASSWORD` в `.env` применяется при создании БД, а пароль существующей роли меняется в PostgreSQL отдельно.

Для доставки писем задайте `LOGIN_EMAIL`, `FROM_EMAIL` и пароль приложения Gmail в `PASSWORD_EMAIL`. Для вложений задайте `YANDEX_CLOUD_KEY_ID`, `YANDEX_CLOUD_KEY` и `BUCKET_NAME`. Ключ `OPENAI_API_KEY=ollama` подходит для локального сервиса Ollama из Compose.

DNS-запись домена должна указывать на публичный IP сервера. Nginx на хосте принимает HTTPS на `443`, использует сертификат для `sparkwork.dpdns.org` и проксирует запросы на `http://127.0.0.1:81`. В этом виртуальном хосте передавайте `Host`, `Upgrade` и `Connection` для WebSocket. Контейнерный Nginx направляет REST и WebSocket чата в FastAPI, а остальные запросы во frontend, который в текущем Compose запускается через Vite. Для обновления адресов контейнеров через DNS используется `resolve`, доступный в Nginx 1.27.3 и новее.

Ограничьте внешний доступ к опубликованным портам frontend, backend, PostgreSQL и Ollama на внешнем сетевом экране. Для HTTPS нужен входящий `443`, а для перенаправления с HTTP и проверки Certbot через HTTP-01 — `80` хостового Nginx.

Из каталога проекта на сервере выполните команды запуска и проверки.

```bash
docker compose --profile prod config --quiet
docker compose --profile prod up -d --build
docker compose --profile prod exec nginx nginx -t
curl -I -H 'Host: sparkwork.dpdns.org' http://127.0.0.1:81/
curl -I https://sparkwork.dpdns.org/
```

## Whisper cache

Папка `./whisper-cache` подключена к backend и Celery worker как `/home/appuser/.cache/whisper`. Whisper скачивает модель при первом запросе на распознавание; последующие запуски используют тот же файл модели. Папка исключена из Git.

## API и WebSocket

Основные маршруты начинаются с `/api/v1`:

| Раздел | Маршрут |
| --- | --- |
| Аутентификация | `/auth` |
| Пользователи | `/users` |
| Чаты | `/chats` |
| Сообщения | `/chats/{chat_id}/messages`, `/messages/{message_id}` |
| Реакции | `/messages/{message_id}/reactions` |
| Вложения | `/attachments/` |
| ИИ | `/ai/chats/{chat_id}/summarize`, `/ai/messages/rewrite` |

Распознавание вложения: `POST /chats/{chat_id}/messages/{message_id}/attachments/{attachment_id}/transcribe`. Оно запускается только после нажатия кнопки распознавания в чате. WebSocket подключается по адресу `ws://localhost:8001/{chat_id}/ws?token=<JWT>`.

## Разработка и проверки

Backend-код находится в `backend/`, frontend — в `frontend/`. Frontend-команды запускаются из `frontend/`:

```bash
npm run dev
npm run build
npm run lint
npm test
```

Backend тесты запускаются в отдельном Docker Compose окружении:

```bash
docker compose --env-file .env.test -f docker-compose.test.yml up -d --build
docker compose --env-file .env.test -f docker-compose.test.yml exec backend-test pytest
docker compose --env-file .env.test -f docker-compose.test.yml down
```

Проверка Python-кода через Ruff выполняется из корня репозитория:

```bash
pip install -r backend/requirements/dev.txt
ruff check .
ruff format --check .
```

Чтобы автоматически отформатировать Python-файлы, выполните `ruff format .`.

Тестовое окружение поднимает отдельные PostgreSQL и Redis; для интеграционных тестов также требуется Docker для Testcontainers.
