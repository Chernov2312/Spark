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

- Docker и Docker Compose. На Windows и macOS можно использовать Docker Desktop.
- Профиль `dev` запускает Ollama в Docker. Значение `OPENAI_API_KEY=ollama` служит заглушкой для SDK. Для `prod` нужен доступ к OpenAI-совместимому API.
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

На сервере нужен Docker Compose 2.24.4 или новее для объединения `docker-compose.yml` и `docker-compose.prod.yml`. Создайте `.env` из `.env.example` для новой установки или отредактируйте действующий файл. Для CD укажите те же настройки в секрете `ENV_SECRET`.

```dotenv
API_BASE_URL=/api/v1
FRONTEND_BASE_URL=https://sparkwork.dpdns.org
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=your-model-id
OPENAI_API_KEY=example-provider-api-key
```

Compose передаёт `API_BASE_URL` во frontend как `VITE_API_URL`. При значении `/api/v1` REST и WebSocket используют домен открытой страницы. Backend использует `FRONTEND_BASE_URL` в ссылках подтверждения почты и сброса пароля.

В Git хранятся `.env.example` с примерами значений и `.env.test` с тестовыми настройками. Рабочие пароли и ключи храните в исключённом из Git файле `.env` на сервере. Для новой установки задайте отдельные значения `SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` и `REDIS_USER_PASSWORD`. Для генерации каждого значения можно использовать `openssl rand -hex 32`. Для существующей БД укажите пароль действующей роли PostgreSQL. Изменение `POSTGRES_PASSWORD` в `.env` применяется при создании БД, а пароль существующей роли меняется в PostgreSQL отдельно.

Замените примеры `OPENAI_*` адресом API вашего провайдера, идентификатором его модели и ключом. В `prod` backend обращается напрямую к этому API. Compose не запускает Ollama и не ждёт скачивания модели. Для доставки писем заполните параметры из раздела «Настройка почты». Для вложений задайте `YANDEX_CLOUD_KEY_ID`, `YANDEX_CLOUD_KEY` и `BUCKET_NAME`.

Для Gemini укажите `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `OPENAI_MODEL=gemini-3.1-flash-lite` и ключ Gemini в `OPENAI_API_KEY`.

DNS-запись домена должна указывать на публичный IP сервера. Nginx на хосте принимает HTTPS на `443`, использует сертификат для `sparkwork.dpdns.org` и проксирует запросы на `http://127.0.0.1:81`. В этом виртуальном хосте передавайте `Host`, `Upgrade` и `Connection` для WebSocket. Контейнерный Nginx направляет REST и WebSocket чата в FastAPI, а остальные запросы во frontend, который в текущем Compose запускается через Vite. Для обновления адресов контейнеров через DNS используется `resolve`, доступный в Nginx 1.27.3 и новее.

Продовый Compose публикует только Nginx на `127.0.0.1:81`. Для HTTPS нужен входящий `443`, а для перенаправления с HTTP и проверки Certbot через HTTP-01 — `80` хостового Nginx.

Из каталога проекта на сервере выполните команды запуска и проверки.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile prod config --quiet
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile prod up --build --wait
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile prod exec nginx nginx -t
curl -I -H 'Host: sparkwork.dpdns.org' http://127.0.0.1:81/
curl -I https://sparkwork.dpdns.org/
```

При переходе со старого продового запуска после старта нового стека остановите контейнеры Ollama командой `docker compose --profile dev stop ollama-model ollama`. CD выполняет эту команду после успешного запуска.

Продовые сервисы пишут в stdout и stderr. Драйвер Docker `local` ротирует журналы с лимитом в пять файлов по 20 МБ на контейнер. Посмотреть последние записи backend, воркера и PostgreSQL можно из каталога проекта.

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile prod logs --tail 100 backend celery postgres
```

### Настройка почты

Почта отправляется фоновым Celery worker через SMTP с SSL: `SMTP_HOST` (по умолчанию `smtp.gmail.com`) и `SMTP_PORT` (по умолчанию `465`). `LOGIN_EMAIL` и `PASSWORD_EMAIL` задают учётные данные SMTP, `FROM_EMAIL` — адрес отправителя, разрешённый вашим провайдером. Для Gmail укажите пароль приложения в `PASSWORD_EMAIL`. Для временных сетевых и SMTP-сбоев письма подтверждения и восстановления пароля повторяются до пяти раз с увеличением задержки. В `dev` после изменения `.env` пересоздайте backend и celery командой `docker compose --profile dev up -d --force-recreate backend celery`. Ошибки и повторные попытки доступны в `logs/backend.log` для `dev` и в журнале контейнера `celery` для `prod`. Успешная SMTP-отправка означает принятие письма сервером, но не гарантирует попадание во «Входящие».

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
