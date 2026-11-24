# Spark

![Go](https://img.shields.io/github/check-runs/Chernov2312/Spark/master?nameFilter=go_ci%20%2F%20calls)

![Linter](https://img.shields.io/github/check-runs/Chernov2312/Spark/master?nameFilter=lint_test%20%2F%20lint_test&label=Ruff)
![Python CI](https://img.shields.io/github/check-runs/Chernov2312/Spark/master?nameFilter=backend_tests%20%2F%20python_test&label=Python)
![TypeScript CI](https://img.shields.io/github/check-runs/Chernov2312/Spark/master?nameFilter=typescript_ci%20%2F%20frontend&label=TypeScript)
![CI/CD](https://github.com/Chernov2312/Spark/actions/workflows/ci.yml/badge.svg?branch=master)
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
- Аудио- и видеозвонки через WebRTC с Go-сервисом сигналинга и гостевыми ссылками.

## Требования

- Docker и Docker Compose. На Windows и macOS можно использовать Docker Desktop.
- Для локальной Ollama можно отдельно запустить профиль `local-ai`. Для production задайте адрес, модель и ключ OpenAI-совместимого API.
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

2. Для профиля `dev` используйте `API_BASE_URL=http://localhost:8001` и `FRONTEND_BASE_URL=http://localhost:5174`. Адреса `postgres:5432` и `redis:6379` в `.env` нужны сервисам внутри сети Compose. Для отправки писем и работы с объектным хранилищем заполните параметры SMTP и Yandex Cloud в `.env`.

3. Соберите и запустите приложение:

   ```bash
   docker compose --profile dev up --build
   ```

   Compose запускает PostgreSQL, Redis, FastAPI, Celery, сервис звонков, LiveKit и frontend. Для запуска задайте ключ и секрет LiveKit в `.env`. Backend применяет миграции Alembic. Повторите команду с `--build` после изменений `backend/requirements/prod.txt`, чтобы установить новые зависимости в образы FastAPI и Celery.

   После обновления с refresh-сессиями перезапустите backend для применения миграции и пересоберите сервис звонков. Следующий вход создаст refresh-сессию сроком `REFRESH_TOKEN_EXPIRE_DAYS` дней. Для браузерной авторизации укажите фактический адрес фронтенда в `FRONTEND_BASE_URL`.

   После изменения `frontend/package-lock.json` перезапустите frontend командой `docker compose --profile dev restart frontend`. При старте контейнер устанавливает зависимости из lock-файла и затем запускает Vite. Журнал доступен через `docker compose --profile dev logs frontend`.

   Если после обновления образа `npm ci` завершается с `EACCES` в `/app/node_modules`, пересоздайте контейнер frontend с новым анонимным томом зависимостей:

   ```bash
   docker compose --profile dev up -d --no-deps --force-recreate --renew-anon-volumes frontend
   ```

4. Если нужен локальный ИИ, задайте `OPENAI_BASE_URL=http://ollama:11434/v1` и имя локальной модели в `OPENAI_MODEL`, например `qwen3:0.6b`. Запустите Ollama и загрузку модели отдельно. Чаты доступны во время загрузки.

   ```bash
   docker compose --profile local-ai up -d ollama ollama-model
   ```

   Для внешнего OpenAI-совместимого API достаточно профиля `dev` и настроек провайдера в `.env`.

Откройте:

- Frontend: <http://localhost:5174>
- API: <http://localhost:8001>
- Swagger UI: <http://localhost:8001/docs>
- Health check: <http://localhost:8001/health>
- PostgreSQL: `localhost:5433`
- Redis: `localhost:6380`
- Ollama API: <http://localhost:11434>

Чтобы остановить сервисы и сохранить данные, выполните `docker compose --profile dev --profile local-ai down`. Для полной очистки также удалите Docker volumes `spark_postgres_data` и `spark_ollama_data`, а также локальную папку `redisdata`.

### Запуск на сервере с HTTPS

На сервере запустите самостоятельный файл `docker-compose.prod.yml`. Создайте `.env` из `.env.example` для новой установки или отредактируйте действующий файл. Для CD укажите те же настройки в секрете `ENV_SECRET`.

```dotenv
API_BASE_URL=/api/v1
FRONTEND_BASE_URL=https://sparkwork.dpdns.org
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=your-model-id
OPENAI_API_KEY=example-provider-api-key
```

При сборке frontend Compose передаёт `API_BASE_URL` как `VITE_API_URL`, а `VITE_CALLS_WS_URL` по умолчанию равен `/v1/calls/ws`. С относительными адресами REST и WebSocket используют домен открытой страницы. После изменения этих переменных пересоберите frontend. Backend использует `FRONTEND_BASE_URL` в ссылках подтверждения почты и сброса пароля.

В Git хранятся `.env.example` с примерами значений и `.env.test` с тестовыми настройками. Рабочие пароли и ключи храните в исключённом из Git файле `.env` на сервере. Для новой установки задайте отдельные значения `SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` и `REDIS_USER_PASSWORD`. Для генерации каждого значения можно использовать `openssl rand -hex 32`. Для существующей БД укажите пароль действующей роли PostgreSQL. Изменение `POSTGRES_PASSWORD` в `.env` применяется при создании БД, а пароль существующей роли меняется в PostgreSQL отдельно.

Замените примеры `OPENAI_*` адресом API вашего провайдера, идентификатором его модели и ключом. В `prod` backend обращается напрямую к этому API. Compose не запускает Ollama и не ждёт скачивания модели. Для доставки писем заполните параметры из раздела «Настройка почты». Для вложений задайте `YANDEX_CLOUD_KEY_ID`, `YANDEX_CLOUD_KEY` и `BUCKET_NAME`.

Для Gemini укажите `OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/`, `OPENAI_MODEL=gemini-3.1-flash-lite` и ключ Gemini в `OPENAI_API_KEY`.

DNS-запись домена должна указывать на публичный IP сервера. Nginx на хосте принимает HTTPS на `443`, использует сертификат для `sparkwork.dpdns.org` и проксирует запросы на `http://127.0.0.1:81`. В этом виртуальном хосте передавайте `Host`, `Upgrade` и `Connection` для WebSocket. Контейнерный Nginx направляет REST и WebSocket чата в FastAPI, маршруты `/v1/calls/` — в Go, а запросы страниц — во frontend. Vite собирает `dist/` при создании production-образа. Nginx внутри frontend отдаёт готовые файлы и возвращает `index.html` для маршрутов React. FastAPI запускается без автоматической перезагрузки. Для обновления адресов контейнеров через DNS используется `resolve`, доступный в Nginx 1.27.3 и новее.

Продовый Compose публикует только Nginx на `127.0.0.1:81`. Для HTTPS нужен входящий `443`, а для перенаправления с HTTP и проверки Certbot через HTTP-01 — `80` хостового Nginx.

При push в `master` GitHub Actions запускает Go CI, Ruff, тесты и сборку образа backend, а также TypeScript CI. Автоматический деплой начинается, когда все четыре workflow успешно завершаются для одного коммита.

Из каталога проекта на сервере выполните команды запуска и проверки.

```bash
docker compose -f docker-compose.prod.yml config --quiet
docker compose -f docker-compose.prod.yml up --build --wait
docker compose -f docker-compose.prod.yml exec nginx nginx -t
curl -I -H 'Host: sparkwork.dpdns.org' http://127.0.0.1:81/
curl -I https://sparkwork.dpdns.org/
```

Продовые сервисы пишут в stdout и stderr. Драйвер Docker `local` ротирует журналы с лимитом в пять файлов по 20 МБ на контейнер. Посмотреть последние записи backend, воркера и PostgreSQL можно из каталога проекта.

```bash
docker compose -f docker-compose.prod.yml logs --tail 100 backend celery postgres
```

### Настройка почты

Почта отправляется фоновым Celery worker через SMTP с SSL: `SMTP_HOST` (по умолчанию `smtp.gmail.com`) и `SMTP_PORT` (по умолчанию `465`). `LOGIN_EMAIL` и `PASSWORD_EMAIL` задают учётные данные SMTP, `FROM_EMAIL` — адрес отправителя, разрешённый вашим провайдером. Для Gmail укажите пароль приложения в `PASSWORD_EMAIL`. Для временных сетевых и SMTP-сбоев письма подтверждения и восстановления пароля повторяются до пяти раз с увеличением задержки. Backend и Celery выводят журналы в Docker stdout/stderr; для просмотра используйте `docker compose --profile dev logs --tail 100 backend celery celery-beat`. После изменения `.env` пересоздайте сервисы командой `docker compose --profile dev up -d --force-recreate backend celery celery-beat`. Успешная SMTP-отправка означает принятие письма сервером, но не гарантирует попадание во «Входящие».

В `.env` используйте формат `ИМЯ=значение` без аннотаций типов Python:

```dotenv
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
```

Запись `SMTP_PORT: int = 465` некорректна: Docker Compose передаёт значение `int = 465`, и задача отправки завершается ошибкой валидации до подключения к SMTP.

### Фоновые уведомления

Из корня проекта с установленными backend-зависимостями сгенерируйте пару VAPID.

```bash
python backend/generate_web_push_keys.py
```

Добавьте выведенные `WEB_PUSH_PUBLIC_KEY` и `WEB_PUSH_PRIVATE_KEY` в `.env` и задайте `WEB_PUSH_SUBJECT` с рабочим контактом в формате `mailto:`. Backend и Celery должны использовать одну пару ключей. При ротации ключей пользователям потребуется снова включить фоновые уведомления в браузере.

Пересоберите backend и Celery по инструкции для своего окружения. При запуске backend применит миграцию таблицы `push_subscriptions`. Откройте Spark через HTTPS или на `localhost`, зайдите в информацию о чате и включите уведомления в разделе «Настройки чата». Web Push использует службу браузера для доставки. Spark подписывает запросы ключом VAPID и шифрует данные с помощью `pywebpush`. [Push API](https://developer.mozilla.org/en-US/docs/Web/API/PushManager/subscribe) · [pywebpush](https://github.com/web-push-libs/pywebpush)

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

В локальной и production-конфигурациях контейнер воркера `celery` ограничен `cpus: 0.5`. Whisper и остальные задачи этого воркера делят лимит в 50% одного логического ядра, поэтому распознавание может занять больше времени. [Лимиты CPU в Docker](https://docs.docker.com/engine/containers/resource_constraints/#cpu)

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

## Звонки

Профиль `dev` и самостоятельный `docker-compose.prod.yml` включают Go-сервис `calls` и LiveKit. Vite в dev и Nginx в prod направляют `/v1/calls/*` в Go. Браузеры устанавливают медиасоединения с LiveKit.

Откройте чат и нажмите «Начать звонок» или выберите «Звонки» в верхней панели для звонка по ссылке без чата. Перед входом можно проверить доступность медиасервера, микрофон, камеру и воспроизведение звука. Участники чата могут зайти в уже идущий звонок через плашку под заголовком. В чатах гостевые ссылки создают владелец и модераторы, а для отдельного звонка ссылкой управляет инициатор. Ссылка, созданная в интерфейсе, работает до выхода последнего участника или ручного отзыва.

Задайте `LIVEKIT_API_KEY` и случайный `LIVEKIT_API_SECRET` длиной от 32 байт в `.env`. Для Docker Desktop укажите локальный IPv4 компьютера в `LIVEKIT_NODE_IP`. В dev медиапорты публикуются на этом адресе и по умолчанию используют `127.0.0.1`. При проблемах с UDP в Docker Desktop задайте `LIVEKIT_DEV_CONFIG=./livekit.dev-tcp.yaml` для ICE/TCP на порту 7881. В prod укажите публичный IP сервера в `LIVEKIT_NODE_IP`, в том числе в `ENV_SECRET` при выкладке через GitHub Actions.

На сервере разрешите входящие соединения на `7882/udp` для WebRTC, `7881/tcp` для резервного ICE/TCP и `3478/udp` для встроенного TURN. HTTP-порт LiveKit `7880` остаётся внутри Compose. Браузер подключается к сигналингу через HTTPS/WSS основного домена. Если внешний HTTPS-прокси журналирует запросы, исключите параметры URL маршрута `/v1/calls/media/` из его журналов. Для сетей, допускающих только исходящий TLS, настройте TURN/TLS по документации LiveKit. [Порты LiveKit](https://docs.livekit.io/transport/self-hosting/ports-firewall/) · [Развёртывание LiveKit](https://docs.livekit.io/transport/self-hosting/deployment/)

Для standalone-запуска укажите ключ, секрет и адрес `LIVEKIT_INTERNAL_URL` (по умолчанию `http://127.0.0.1:7880`) в окружении Go и выполните `go run .` из `calls/`. Go слушает порт 8002 и по умолчанию обращается к Python на `http://127.0.0.1:8001/api/v1`. Для standalone-фронтенда задайте `VITE_CALLS_WS_URL=ws://localhost:8002/v1/calls/ws` и фактический origin в `FRONTEND_BASE_URL` у Go-сервиса. Дополнительные origins принимает `CALLS_ALLOWED_ORIGINS` через запятую. [API звонков](api.md#9-звонки-взаимодействие-go-python-и-livekit)

## Разработка и проверки

### Go-сервис звонков

Образы backend, frontend и сервиса звонков запускают приложение с UID и GID `65532:65532`. На Linux предоставьте этому UID запись в примонтированные `logs/` и `whisper-cache/`.

Точка входа — `calls/main.go`. Пакет `internal/config` читает настройки окружения, а `internal/livekit` выпускает медиатокены и обращается к RoomService. Клиент FastAPI в `internal/sparkapi` получает профиль пользователя и состав чата. В `internal/signaling` находятся маршруты HTTP, обработчики WebSocket и состояние активных звонков и приглашений. Тесты каждого пакета лежат рядом с его кодом.

Из каталога `calls/` запустите `go test -cover ./...` и `golangci-lint run` (версия `2.11.3`). GitHub Actions также запускает тесты с детектором гонок, требует покрытие инструкций от 85% и прикладывает отчёт `go-coverage` к запуску. Для тестов Go не нужны запущенные FastAPI и Docker.

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

Для запуска с локальными тестовыми ключами используйте `--env-file .env.test.local` во всех трёх командах. Этот файл содержит настройки из `.env.test`, индивидуальные значения ключей и строку `SPARK_TEST_ENV_FILE=.env.test.local`, которая выбирает тот же файл для контейнеров. Git игнорирует его. На Linux задайте `DOCKER_SOCKET_GID` равным результату `stat -c %g /var/run/docker.sock`, чтобы тестовый пользователь мог запускать Testcontainers. Для каждого запуска Python CI генерирует отдельные ключ JWT и пароли PostgreSQL и Redis.

Тестовое окружение поднимает отдельные PostgreSQL и Redis; для интеграционных тестов также требуется Docker для Testcontainers.
