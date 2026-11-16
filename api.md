# Spark — REST и WebSocket API

Документация описывает маршруты, зарегистрированные в текущем бэкенде. Актуальные интерактивные схемы FastAPI доступны по адресу `/docs`, OpenAPI — `/openapi.json`; проверка состояния — `GET /health`.

HTTP API использует префикс `/api/v1`. Все перечисленные ниже маршруты, кроме регистрации, входа и подтверждения электронной почты, требуют JWT в заголовке:

```http
Authorization: Bearer <access_token>
```

## 1. Аутентификация — `/api/v1/auth`

### `POST /api/v1/auth/register`

Создает пользователя и ставит задачу отправки письма с подтверждением. До подтверждения email access token не выдается.

Запрос (`application/json`):

```json
{
  "username": "john_doe",
  "tag": "john_doe",
  "email": "john@example.com",
  "password": "StrongPass123"
}
```

Поле `tag` необязательно: если его не передать, сервер создаст свободный тег на основе имени пользователя. Теги нормализуются и уникальны.

Ответ `201 Created`:

```json
{
  "id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
  "username": "john_doe",
  "tag": "john_doe",
  "email": "john@example.com",
  "verification_required": true
}
```

Ссылка в письме ведет на `FRONTEND_BASE_URL/verify-email/{verification_token}`. Фронтенд показывает страницу подтверждения и отправляет `GET /api/v1/auth/verification/{verification_token}`. После успешной проверки API возвращает пользователя и access token; фронтенд сохраняет токен и открывает страницу чатов.

### `POST /api/v1/auth/login`

Вход принимает `application/x-www-form-urlencoded` (или `multipart/form-data`) с полями `username` и `password`. В поле `username` можно передать уникальный тег, имя пользователя или адрес электронной почты.

Ответ `200 OK` содержит пользователя и JWT в `access_token`. Для неподтвержденного аккаунта возвращается `403 Forbidden`, для неверных учетных данных — `401 Unauthorized`.

### `GET /api/v1/auth/verification/{verification_token}`

Подтверждает email по токену из письма и возвращает пользователя с новым access token (`200 OK`). Повторное использование действующего токена безопасно и также возвращает токен. Недействительный или просроченный токен приводит к `401 Unauthorized`.

## 2. Пользователи — `/api/v1/users`

### `GET /api/v1/users/me`

Возвращает профиль текущего пользователя (`200 OK`):

```json
{
  "id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
  "username": "john_doe",
  "email": "john@example.com",
  "avatar_urls": ["https://storage.example/signed-avatar-url"],
  "created_at": "2026-10-03T09:21:00Z"
}
```

`avatar_urls` содержит временные ссылки на изображения из хранилища. Срок действия ссылки ограничен. В текущем обработчике `get_me` значение `get_object` передается вторым позиционным аргументом `get_temporary_url`, который трактуется как `expires_in`; поэтому выдача ссылок может завершаться ошибкой.

### `PATCH /api/v1/users/me`

Обновляет имя пользователя и/или адрес электронной почты. Оба поля необязательны.

Запрос:

```json
{
  "username": "new_john_doe",
  "email": "new_email@example.com"
}
```

Ответ — объект профиля (`200 OK`). Несуществующий пользователь приводит к `404 Not Found`.

### `POST /api/v1/users/me/delete/avatar`

Запрос принимает `Avatar` с полем `url` (`application/json`). Здесь передается ключ объекта из хранилища (`file_key`), а не временная URL-ссылка:

```json
{
  "url": "user_avatar/11111111-eeee-aaaa-bbbb-cccccccccccc/2026-10-28_12-00-00.webp"
}
```

При успешном удалении ожидается `204 No Content`; если вложение не найдено для текущего пользователя — `404 Not Found`. Текущая реализация вызывает `S3Storage.delete_avatar`, которого нет в `S3Storage`; удаление поэтому не завершится успешно.

Отдельного маршрута `POST /users/me/avatar` нет. Чтобы зарегистрировать пользовательский аватар, используйте общий media-поток: временная ссылка с `type: "user_avatar"`, прямая загрузка `PUT`, затем создание вложения с `chat_id: null` и `is_avatar: true`.

## 3. Чаты — `/api/v1/chats`

### Создание группы, поиск участников и аватары

Форма создания отправляет `POST /api/v1/chats` с `id: null`, списком `invited_user_ids` (UUID выбранных пользователей) и пустым `avatar_urls`. Название и описание обязательны.

Поиск участников выполняется по username:

```http
GET /api/v1/users/search?username=john&limit=20
```

Ответ:

```json
{
  "users": [
    {
      "id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
      "username": "john_doe",
      "avatar_urls": []
    }
  ]
}
```

Выбранные идентификаторы передаются при создании группы. Для уже созданной группы участников можно добавить через `POST /api/v1/chats/{chat_id}/users` с телом `{"user_ids": ["<user_id>"]}`.

Группа может иметь несколько изображений. Для каждого файла frontend запрашивает временный URL с `type: "chat_avatar"` и `target_id` группы, загружает файл прямым HTTP `PUT`, затем регистрирует вложение через `POST /api/v1/attachments/` с `chat_id`, `is_avatar: true`, `file_key`, `file_name`, `file_size` и `mime_type`. Все изображения отображаются из массива `avatar_urls`, возвращаемого `GET /api/v1/chats`.

### `GET /api/v1/chats`

Возвращает список чатов текущего пользователя (`200 OK`):

```json
{
  "chats": [
    {
      "id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
      "title": "Команда разработки",
      "description": "Рабочий чат проекта",
      "owner_id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
      "created_at": "2026-10-01T12:00:00Z",
      "updated_at": "2026-10-03T09:25:00Z",
      "avatar_urls": []
    }
  ]
}
```

### `POST /api/v1/chats`

Создает чат. `id` — обязательное nullable-поле (передайте `null` для создания нового чата); `title` обязателен (до 50 символов), `description` обязателен (до 150 символов), `invited_user_ids` — обязательный массив UUID (может быть пустым). `avatar_urls` — необязательный массив строк.

Запрос:

```json
{
  "id": null,
  "title": "Новая группа",
  "description": "Обсуждение интеграции",
  "invited_user_ids": ["22222222-eeee-aaaa-bbbb-cccccccccccc"],
  "avatar_urls": []
}
```

Ответ `201 Created` включает `id`, `owner_id`, `title`, `description`, `invited_user_ids`, `users_count`, `created_at` и `avater_urls` (именно так поле названо в текущей схеме ответа).

### `PATCH /api/v1/chats/{chat_id}`

Редактирует чат. Запрос требует оба поля — `title` (до 50 символов) и `description` (до 150 символов), несмотря на использование метода `PATCH`. Изменять чат может только его владелец.

Ответ `200 OK` — объект чата. Возможные ошибки: `404 Not Found`, `403 Forbidden`.

### `POST /api/v1/chats/{chat_id}/users`

Добавляет пользователей в чат. Только владелец чата может добавлять участников.

Запрос:

```json
{
  "user_ids": ["22222222-eeee-aaaa-bbbb-cccccccccccc"]
}
```

Ответ `200 OK`:

```json
{
  "status": "success"
}
```

В текущей реализации нет HTTP-маршрутов для удаления участника или выхода из чата. Аватары пользователя и чата используют общий media-поток ниже с `type` соответственно `user_avatar` и `chat_avatar`; отдельного маршрута загрузки аватара чата нет.

## 4. Сообщения

### `GET /api/v1/chats/{chat_id}/messages`

Возвращает историю чата (`200 OK`).

Query-параметры:

- `limit` — количество сообщений, по умолчанию `50`.
- `before` — дата и время в формате ISO 8601; используется как курсор.

Ответ:

```json
{
  "messages": [
    {
      "id": "44444444-eeee-aaaa-bbbb-cccccccccccc",
      "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
      "user_id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
      "text": "Привет всем!",
      "user_reaction": "👍",
      "attachments": [
        {
          "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
          "file_key": "user_message/11111111-eeee-aaaa-bbbb-cccccccccccc/file.webp",
          "file_name": "image.jpg",
          "file_size": 2048,
          "mime_type": "image/jpeg",
          "text": null
        }
      ],
      "reactions_count": {
        "👍": 3
      },
      "created_at": "2026-10-03T09:10:00Z"
    }
  ]
}
```

`user_reaction` и `text` могут быть `null`; `attachments` и `reactions_count` могут быть пустыми.

### `POST /api/v1/chats/{chat_id}/messages`

Отправляет сообщение (`201 Created`). Требуется хотя бы непустой текст или одно вложение. Максимум 10 вложений. Текст может быть `null`.

Запрос (`application/json`):

```json
{
  "text": "Посмотрите на этот макет",
  "attachments": [
    {
      "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
      "file_key": "user_message/11111111-eeee-aaaa-bbbb-cccccccccccc/file.webp",
      "file_name": "image.jpg",
      "file_size": 2048,
      "mime_type": "image/jpeg",
      "text": null
    }
  ]
}
```

Вложение передается объектом, а не UUID. `file_key` — ключ объекта, полученный в ответе media-маршрута; `file_size` должен быть неотрицательным числом. Вложение требует `chat_id`, `file_key`, `file_name`, `file_size` и `mime_type`; `text` необязателен.

Ответ содержит `id`, `chat_id`, `user_id`, `text`, `user_reaction`, `attachments`, `reactions_count` и `created_at`. Схема `AttachmentRequest` задает `file_key`, тогда как обработчик формирует вложения ответа с `attachment_url`; проверьте фактический ответ после исправления этого несоответствия.

### `PUT /api/v1/messages/{message_id}`

Редактирует сообщение текущего пользователя. Тело запроса соответствует `MessageRequest`: можно передать текст, вложения или оба поля, но сообщение не должно быть пустым. Ответ — объект сообщения (`200 OK`). Если сообщение не найдено или пользователь не имеет права его редактировать — `404 Not Found`.

### `DELETE /api/v1/messages/{message_id}`

Удаляет сообщение текущего пользователя. Успешный ответ — объект удаленного сообщения (`200 OK`); если сообщение не найдено или пользователь не имеет права его удалять — `404 Not Found`.

## 5. Реакции — `/api/v1/messages/{message_id}/reactions`

Реакции обрабатываются через Redis и синхронизируются с базой данных фоновой задачей Celery.

### `POST /api/v1/messages/{message_id}/reactions`

Добавляет реакцию, переключает реакцию на другой emoji или снимает ее, если пользователь повторно отправил тот же emoji. Тело запроса:

```json
{
  "emoji": "🔥"
}
```

Поле `emoji` ограничено 10 символами. Ответ `200 OK`:

```json
{
  "message_id": "44444444-eeee-aaaa-bbbb-cccccccccccc",
  "updated_reactions_count": {
    "🔥": 1
  }
}
```

### `DELETE /api/v1/messages/{message_id}/reactions`

Удаляет реакцию текущего пользователя, если она есть. Ответ `200 OK` содержит `message_id` и актуальный `updated_reactions_count`.

## 6. Медиа и аватары — `/api/v1/attachments`

Файлы загружаются напрямую в объектное хранилище по временной ссылке. Один и тот же протокол используется для сообщений и аватаров; назначение задается полем `type`.

### Шаг 1. Получить временную ссылку — `POST /api/v1/attachments/temporary-url`

Требуется JWT. Запрос (`application/json`):

```json
{
  "file_extension": "webp",
  "file_content": "image/webp",
  "target_id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
  "type": "user_avatar"
}
```

Поля:

- `file_extension` — расширение файла без точки.
- `file_content` — MIME-тип файла, например `image/webp` или `image/jpeg`.
- `target_id` — строковый идентификатор целевого пользователя или группы. Для `message` и `user_avatar` передается ID пользователя; для `chat_avatar` — ID группы.
- `type` — `message`, `user_avatar` или `chat_avatar`.

Для `user_avatar` и `chat_avatar` разрешены JPEG, PNG, WebP и GIF. Ответ содержит `temporary_url`, `file_key` и один из идентификаторов:

```json
{
  "user_id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
  "chat_id": null,
  "temporary_url": "https://storage.example/presigned-put-url",
  "file_key": "user_avatar/11111111-eeee-aaaa-bbbb-cccccccccccc/2026-10-28_12-00-00.webp"
}
```

При `type: "chat_avatar"` ответ содержит `chat_id`; для остальных типов — `user_id`. Реализация использует временную ссылку как URL для HTTP `PUT`.

Запрос для аватара чата отличается только значением `type` и идентификатором:

```json
{
  "file_extension": "webp",
  "file_content": "image/webp",
  "target_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
  "type": "chat_avatar"
}
```

### Шаг 2. Загрузить файл по временной ссылке

Отправьте байты файла методом `PUT` непосредственно на `temporary_url`, передав `Content-Type`, соответствующий `file_content`. Не отправляйте этот запрос через API `/api/v1` и не добавляйте JWT к внешнему URL хранилища.

```http
PUT <temporary_url>
Content-Type: image/webp

<байты файла>
```

Для любого аватара используйте тот же маршрут временной ссылки:

| Назначение | `type` | `target_id` |
| --- | --- | --- |
| Аватар пользователя | `user_avatar` | UUID пользователя |
| Аватар чата | `chat_avatar` | UUID чата |

### Шаг 3. Зарегистрировать вложение — `POST /api/v1/attachments/`

После успешного `PUT` зарегистрируйте вложение (`application/json`). Для сообщения передайте UUID чата и `is_avatar: false` (или опустите необязательный флаг); для пользовательского аватара — `chat_id: null` и `is_avatar: true`:

```json
{
  "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
  "is_avatar": false,
  "file_key": "user_message/11111111-eeee-aaaa-bbbb-cccccccccccc/2026-10-28_12-00-00.webp",
  "file_name": "image.webp",
  "file_size": 2048,
  "mime_type": "image/webp",
  "text": null
}
```

Схема `AttachmentRequest` требует `chat_id` (nullable, но поле обязательно), `file_key`, `file_name`, `file_size` и `mime_type`; `is_avatar` по умолчанию `false`, `text` необязателен. Схема ответа `AttachmentResponse` содержит `id`, `attachment_url`, `file_name`, `file_size`, `mime_type`, `text`, `user_id` и `chat_id`.

Пример регистрации аватара пользователя:

```json
{
  "chat_id": null,
  "is_avatar": true,
  "file_key": "user_avatar/11111111-eeee-aaaa-bbbb-cccccccccccc/2026-10-28_12-00-00.webp",
  "file_name": "avatar.webp",
  "file_size": 2048,
  "mime_type": "image/webp",
  "text": null
}
```

> **Ограничения текущей реализации:** `POST /attachments/` обращается к `AttachmentRequest.chat_id` как к атрибуту класса, а затем читает у экземпляра поля `content_type`, `filename` и `size`, тогда как схема объявляет `mime_type`, `file_name` и `file_size`. Поэтому регистрация вложения может завершиться ошибкой, и успешное сохранение аватара не гарантируется. Для `chat_avatar` также создается UUID без аргумента, а ответ `AvatarUrlResponse` требует оба nullable-идентификатора, хотя обработчик передает только один.

> **Аватары:** схема `AttachmentRequest` содержит `is_avatar`; чтобы пользовательский аватар попал в связь аватаров профиля, запись должна быть создана с `chat_id: null`, `is_avatar: true` и `file_key` загруженного объекта. Тип `user_avatar` в запросе временной ссылки сам по себе не создает запись в БД. Для удаления передавайте этот ключ в поле `url` маршрута `/users/me/delete/avatar`; текущий обработчик удаления также вызывает отсутствующий `S3Storage.delete_avatar`.

В `S3Storage.get_temporary_url` параметр `client_method` поддерживает назначение ссылки (`put_object` для загрузки, `get_object` для чтения). Временные ссылки для чтения, возвращаемые API, следует считать краткоживущими.

## 7. ИИ — `/api/v1/ai`

### `POST /api/v1/ai/chats/{chat_id}/summarize`

Создает краткое содержание сообщений чата. Параметр `limit` передается в query string и по умолчанию равен `100`; тело запроса не требуется.

Ответ `200 OK`:

```json
{
  "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
  "summary": "Краткое содержание переписки.",
  "generated_at": "2026-10-03T09:26:00Z"
}
```

Для пустого чата возвращается `422 Unprocessable Entity`.

### `POST /api/v1/ai/messages/rewrite`

Переписывает текст в указанном режиме.

Запрос:

```json
{
  "text": "Я завтра опоздаю на встречу.",
  "mode": "professional"
}
```

Поддерживаются режимы `professional`, `friendly`, `fix_grammar`, `make_longer`. Если `mode` не указан, используется `professional`.

Ответ `200 OK`:

```json
{
  "original_text": "Я завтра опоздаю на встречу.",
  "modified_text": "К сожалению, завтра я опоздаю на встречу."
}
```

Маршрута для Smart Replies в текущей реализации нет.

## 8. WebSocket

Подключение к чату:

```text
ws://localhost:8001/{chat_id}/ws?token=<access_token>
```

Токен передается в query-параметре `token`. После подключения сервер подписывается на Redis-канал чата. Все события должны быть JSON-объектами с полями `event` и `data`; неподдерживаемый тип события приводит к ошибке валидации.

### События клиента

#### `message:new`

Содержимое сообщения:

```json
{
  "event": "message:new",
  "data": {
    "id": "44444444-eeee-aaaa-bbbb-cccccccccccc",
    "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
    "user_id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
    "text": "Привет!",
    "attachments": []
  }
}
```

Для события требуются `id`, `chat_id`, `user_id` и `text`; `attachments` — массив строк, по умолчанию пустой. HTTP-отправка сообщений выполняется через `POST /api/v1/chats/{chat_id}/messages`.

#### `user:typing`

```json
{
  "event": "user:typing",
  "data": {
    "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc"
  }
}
```

Сервер устанавливает `user_id` отправителя и рассылает событие участникам канала чата.

#### `chat:update`

```json
{
  "event": "chat:update",
  "data": {
    "chat_id": "33333333-eeee-aaaa-bbbb-cccccccccccc",
    "title": "Новое название",
    "avatar_url": "https://storage.example/avatar"
  }
}
```

Событие пересылается через Redis другим подписчикам чата. HTTP API для обновления названия чата доступно отдельно через `PATCH /api/v1/chats/{chat_id}`.

#### `attachment:text`

Событие распознавания аудио в текущей схеме WebSocket задает поля `message_id`, `audio_url`, а также необязательные `user_id` и `text`. Обработчик фоновой задачи также обращается к `chat_id` в данных события, хотя в схеме `AttachmentText` это поле не объявлено. Поэтому контракт распознавания через WebSocket в текущей реализации несогласован; полагайтесь на него только после проверки исправленной схемы и реализации.

Событие `attachment:text`, опубликованное сервером после обработки аудио, содержит `message_id`, `text`, `user_id` и `audio_url`.

Сервер передает полученные события `message:new`, `chat:update` и `user:typing` через Redis-подписку. События `chat:updated`, `chat:typing`, `message:send`, `ai:typing` и `ai:stream_chunk` текущей схемой не поддерживаются.
