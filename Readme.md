# Spark

Spark — веб-мессенджер с REST API и WebSocket-соединениями. Backend работает на FastAPI, PostgreSQL хранит данные, Redis передаёт события чатов и обслуживает очередь сообщений, Celery запускает фоновые задачи.

## Возможности

- Регистрация, подтверждение почты и вход по JWT.
- Личные и групповые чаты, профили, аватары и статусы набора текста.
- Сообщения с файлами, изображения в чате и реакции.
- Поиск по пользователям и создание групповых чатов.
- Опросы и викторины: анонимное или открытое голосование, настройка отмены ответа и показ правильного варианта после голосования.
- Форматирование сообщений, краткое содержание переписки и переписывание текста через Ollama с OpenAI-совместимым клиентом.
- Распознавание голосовых вложений через Whisper по запросу пользователя.
- Загрузка файлов в S3-совместимое хранилище Yandex Cloud.

## Требования

- Docker Desktop с Docker Compose.
- Ollama запускается в Docker и не требует внешнего API-ключа. Для реальной отправки почты и загрузки файлов укажите соответствующие значения в `.env`.
- Backend image использует Python 3.13 и FFmpeg для подготовки аудио к Whisper.

## Запуск через Docker Compose

Все команды выполняются из корня проекта.

1. Создайте конфигурацию из шаблона:

   ```powershell
   Copy-Item .env.example .env
   ```

   На macOS/Linux:

   ```bash
   cp .env.example .env
   ```

2. Для локальной разработки оставьте `API_BASE_URL=http://localhost:8001` и `FRONTEND_BASE_URL=http://localhost:5174` в `.env`. Первая настройка задаёт адрес API для браузера, вторая — адрес фронтенда в ссылках подтверждения почты. При необходимости измените `OLLAMA_MODEL` и `OLLAMA_BASE_URL`; по умолчанию используется `qwen3:0.6b` и адрес `http://ollama:11434`. Укажите реальные ключи Yandex Cloud и SMTP, если нужны эти интеграции. Тестовые заглушки из `.env.example` не подходят для отправки писем и работы с объектным хранилищем.

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

Почта отправляется фоновым Celery worker через SMTP с SSL: `SMTP_HOST` (по умолчанию `smtp.gmail.com`) и `SMTP_PORT` (по умолчанию `465`). `LOGIN_EMAIL` и `PASSWORD_EMAIL` задают учётные данные SMTP, `FROM_EMAIL` — адрес отправителя, разрешённый вашим провайдером. Для временных сетевых и SMTP-сбоев письма подтверждения и восстановления пароля повторяются до пяти раз с увеличением задержки. После изменения `.env` пересоздайте backend и celery: `docker compose --profile dev up -d --force-recreate backend celery`. Ошибки и повторные попытки доступны в `logs/backend.log`. Успешная SMTP-отправка означает принятие письма сервером, но не гарантирует попадание во «Входящие».

В `.env` используйте формат `ИМЯ=значение` без аннотаций типов Python:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

Запись `SMTP_PORT: int = 465` некорректна: Docker Compose передаёт значение `int = 465`, и задача отправки завершается ошибкой валидации до подключения к SMTP.

## Очистка пользователей

`backend/cleardb.py` удаляет всех пользователей, сообщения и связанные записи в одной транзакции. Таблицы и миграции сохраняются. Скрипт не очищает Redis, S3 или кеши моделей. Перед очисткой остановите backend и Celery, чтобы они не записывали данные во время удаления.

PostgreSQL должен быть запущен. Для БД проекта поднимите только её контейнер:

```powershell
docker compose --profile dev up -d --wait postgres
.\venv\Scripts\python.exe .\backend\cleardb.py
```

При запуске на компьютере адрес `postgres` из `.env` заменяется на `127.0.0.1:5433`; внутри Docker используется `postgres:5432`. Для другой БД или изменённого проброса порта передайте `--host` и `--port`. `.env` загружается из корня проекта независимо от текущего каталога.

Без локального Python можно выполнить:

```bash
docker compose --profile dev run --rm --no-deps backend python cleardb.py
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

После обновления с опросами примените миграцию `e8c2a490b517`: `docker compose --profile dev exec backend alembic upgrade head`. При обычном запуске контейнера миграции применяются автоматически через `entrypoint.sh`.

Backend-код находится в `backend/`, frontend — в `frontend/`. Frontend-команды запускаются из `frontend/`:

```bash
npm run dev
npm run build
npm run lint
npm run typecheck
npm test
```

Браузерные тесты запускаются отдельно:

```bash
npx playwright install chromium
npm run test:e2e
```

Playwright сам поднимает Vite на `127.0.0.1:5173`. Для уже запущенного frontend задайте `PLAYWRIGHT_BASE_URL` (например, `http://127.0.0.1:5174`); тогда тестовый сервер не запускается. REST API, загрузка файлов и WebSocket в этих сценариях замоканы: работающий backend не нужен, неожиданные API-запросы и необработанные ошибки браузера завершают тест с ошибкой. Аудио и фото для проверки загрузок берутся из `backend/tests/`, поэтому запускайте тесты из полного checkout репозитория.

Vitest проверяет компоненты и утилиты (`src/**/*.test.ts`, `src/**/*.test.tsx`). Тесты страницы чата разделены по сообщениям, профилю, медиа и опросам; общие фабрики и моки находятся в `frontend/src/test/`. Браузерные сценарии в `frontend/e2e/` проверяют авторизацию, регистрацию, прокрутку и поиск, закрепы, профили, настройки, галерею аватарок, опросы и загрузку/скачивание вложений. Это проверки frontend с контролируемыми ответами API; backend проверяется отдельно.

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
