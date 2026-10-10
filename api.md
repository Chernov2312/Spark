# 📱 Спецификация REST & WebSocket API для Мессенджера (v4.0)

Настоящая спецификация представляет собой законченный технический контракт взаимодействия клиентской стороны (Frontend) и серверной части (Backend), спроектированный на основе предоставленной ER-диаграммы базы данных и расширенный функциями искусственного интеллекта.

---

## 🔐 1. Аутентификация и авторизация (`/api/v1/auth`)

Все эндпоинты, кроме регистрации и логина, требуют обязательной передачи JWT-токена в заголовке авторизации:
`Authorization: Bearer <JWT_TOKEN>`

### `POST /api/v1/auth/register` — Регистрация пользователя

- **Тело запроса (JSON):**
  ```json
    username: "chel"
    email: "john@example.com"
    password: "strongpassword123" 
  ```
- **Ответ (201 Created):**
  ```json
  {
    "id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
    "username": "john_doe",
    "email": "pivo",
    "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
    "token_type" = "bearer"
  }
  ```

### `POST /api/v1/auth/login` — Авторизация пользователя

- **Тело запроса (Form Data / URL-encoded):**
  ```ini
    email: "john@example.com" # Тут можно указать  username: "chel"
    password: "strongpassword123" 
  ```
- **Ответ (200 OK):**
  ```json
  {
    "id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
    "username": "john_doe",
    "email": "pivo",
    "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
    "token_type" = "bearer"
  }
  ```

---

## 👤 2. Профиль пользователя (`/api/v1/users`)

### `GET /api/v1/users/me` — Получение профиля текущего пользователя

- **Ответ (200 OK):**
  ```json
  {
    "id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
    "username": "john_doe",
    "email": "john@example.com",
    "avatar_url": "https://storage.cdn.com/avatars/user_1.jpg",
    "created_at": "2026-10-03T09:21:00Z"
  }
  ```

### `PATCH /api/v1/users/me` — Частичное обновление данных профиля

- **Тело запроса (JSON):** _(Все поля опциональны)_
  ```json
  {
    "username": "new_john_doe",
    "email": "new_email@example.com"
  }
  ```
- **Ответ (200 OK):**
  ```json
  {
    "id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
    "username": "new_john_doe",
    "email": "new_email@example.com",
    "avatar_url": "https://storage.cdn.com/avatars/user_1.jpg",
    "updated_at": "2026-10-03T09:25:00Z"
  }
  ```

### `POST /api/v1/users/me/avatar` — Обновление аватара пользователя

- **Тело запроса:** `multipart/form-data` (файл передается в поле `avatar`)
- **Логика:** Файл сохраняется на S3, создается соответствующая запись в таблице `images`, поле `image_url` связывается с текущим `user_id`.
- **Ответ (200 OK):**
  ```json
  {
    "avatar_url": "https://storage.cdn.com/avatars/new_avatar_user_1.jpg"
  }
  ```

### `POST /api/v1/users/me/delete/avatar` — Удаление аватара пользователя

- **Тело запроса (JSON):**
  ```json
  {
    "url": "http://choto"
  }
  ```
- **Ответ (204 No content):** Возвращать нечего

---

## 💬 3. Управление чатами (`/api/v1/chats`)

### `GET /api/v1/chats` — Получение списка чатов пользователя

- **Ответ (200 OK):**
  ```json
  [
    {
      "id": "c3333333-eeee-aaaa-bbbb-cccccccccccc",
      "title": "Команда разработки",
      "description": "Рабочий чат проекта",
      "author_id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
      "avatar_url": "https://storage.cdn.com/avatars/chat_1.jpg",
      "created_at": "2026-10-01T12:00:00Z",
      "last_message": {
        "text": "Привет! Как успехи?",
        "created_at": "2026-10-03T09:15:00Z"
      }
    }
  ]
  ```

### `POST /api/v1/chats` — Создание нового чата

- **Тело запроса (JSON):**
  ```json
  {
    "title": "Новая группа",
    "description": "Обсуждение ИИ-интеграции",
    "invited_user_ids": ["uuid-user-1", "uuid-user-2"]
  }
  ```
- **Ответ (201 Created):** Возвращает структуру созданного объекта чата. 
```json
  {
      "id": ,
      "owner_id": ,
      "title": ,
      "description": ,
      "users_count": ,
  }
```

### `PATCH /api/v1/chats/{chat_id}` — Редактирование параметров чата

- _Доступность: Только создателю чата (`author_id`) или администраторам._
- **Тело запроса (JSON):** _(Все поля опциональны)_
  ```json
  {
    "title": "Новое название чата",
    "description": "Обновленное описание группы"
  }
  ```
- **Ответ (200 OK):**
  ```json
  {
    "id": "c3333333-eeee-aaaa-bbbb-cccccccccccc",
    "title": "Новое название чата",
    "description": "Обновленное описание группы",
    "author_id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
    "updated_at": "2026-10-03T09:25:00Z"
  }
  ```

### `POST /api/v1/chats/{chat_id}/avatar` — Обновление аватара чата

- **Тело запроса:** `multipart/form-data` (поле `avatar`)
- **Ответ (200 OK):**
  ```json
  {
    "chat_avatar_url": "https://storage.cdn.com/avatars/new_chat_avatar.jpg"
  }
  ```

### `POST /api/v1/chats/{chat_id}/users` — Добавление пользователя в чат

- **Тело запроса (JSON):** `{ "user_id": "uuid-пользователя" }`
- **Ответ (200 OK):** `{ "status": "success" }`

### `DELETE /api/v1/chats/{chat_id}/users/{user_id}` — Удаление участника или выход из чата

- **Ответ:** `204 No Content`

---

## ✉️ 4. Сообщения (`/api/v1/chats/{chat_id}/messages`)

### `GET /api/v1/chats/{chat_id}/messages` — Получение истории сообщений

- **Query параметры:** `limit=50` (по умолчанию), `before=uuid_или_timestamp` (курсорная пагинация).
- **Ответ (200 OK):**
  ```json
  {
    "messages": [
      {
        "id": "m4444444-eeee-aaaa-bbbb-cccccccccccc",
        "chat_id": "c3333333-eeee-aaaa-bbbb-cccccccccccc",
        "user_id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
        "text": "Привет всем!",
        "reactions_count": { "👍": 3, "❤️": 1 },
        "attachments": [
          {
            "id": "att-55555555-eeee-aaaa-bbbb-cccccccccccc",
            "url": "https://cdn.com",
            "mime_type": "image/jpeg"
          }
        ],
        "created_at": "2026-10-03T09:10:00Z"
      }
    ]
  }
  ```

### `POST /api/v1/chats/{chat_id}/messages` — Отправка сообщения через HTTP

- **Тело запроса (JSON):**
  ```json
  {
    "text": "Посмотрите на эти макеты",
    "attachment_ids": [
      "att-55555555-eeee-aaaa-bbbb-cccccccccccc",
      "att-66666666-eeee-aaaa-bbbb-cccccccccccc"
    ]
  }
  ```
- *Валидация: хотя бы одно из полей (`text` или `attachment_ids`) должно быть заполнено.*
- **Ответ (201 Created):**
  ```json
  {
    "id": "m4444444-eeee-aaaa-bbbb-cccccccccccc",
    "chat_id": "c3333333-eeee-aaaa-bbbb-cccccccccccc",
    "user_id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
    "text": "Посмотрите на эти макеты",
    "attachments": [
      {
        "id": "att-55555555-eeee-aaaa-bbbb-cccccccccccc",
        "url": "https://cdn.com",
        "mime_type": "image/jpeg"
      },
      {
        "id": "att-66666666-eeee-aaaa-bbbb-cccccccccccc",
        "url": "https://cdn.com",
        "mime_type": "image/jpeg"
      }
    ],
    "created_at": "2026-10-10T14:15:00Z"
  }
  ```

### `PUT /api/v1/messages/{message_id}` — Редактирование сообщения

- **Тело запроса (JSON):** `{ "text": "Обновленный текст" }`
- **Ответ (200 OK)**

### `DELETE /api/v1/messages/{message_id}` — Удаление сообщения

- **Ответ:** `204 No Content`

---

## 👍 5. Реакции (`/api/v1/messages/{message_id}/reactions`)

При добавлении/удалении реакции бэкенд пересчитывает JSONB-поле `reactions_count` в таблице `messages` и сохраняет/удаляет запись в `messagereactions`.

### `POST /api/v1/messages/{message_id}/reactions` — Добавление или изменение реакции

- **Тело запроса (JSON):** `{ "emoji": "🔥" }`
- **Ответ (200 OK):**
  ```json
  {
    "message_id": "m4444444-eeee-aaaa-bbbb-cccccccccccc",
    "updated_reactions_count": { "👍": 3, "🔥": 1 }
  }
  ```

### `DELETE /api/v1/messages/{message_id}/reactions` — Удаление своей реакции

- **Ответ (200 OK):** Возвращает обновленный объект `updated_reactions_count`.

---

## 🖼️ 6. Медиафайлы (`/api/v1/images`)

### `POST /api/v1/images/upload` — Загрузка изображений для отправки в сообщения

- **Тело запроса:** `multipart/form-data` (файл в поле `image`, необязательные query параметры: `chat_id=uuid`)
- **Ответ (201 Created):**
  ```json
  {
    "id": "img55555-eeee-aaaa-bbbb-cccccccccccc",
    "image_url": "https://storage.cdn.com/attachments/file.jpg",
    "user_id": "u1111111-eeee-aaaa-bbbb-cccccccccccc",
    "chat_id": "c3333333-eeee-aaaa-bbbb-cccccccccccc"
  }
  ```

---

## 🤖 7. Интеграция с ИИ нейросетью (`/api/v1/ai`)

### `GET /api/v1/ai/messages/{message_id}/smart-replies` — Генерация контекстных ответов (Smart Replies)

- **Назначение:** Позволяет фронтенду отобразить кнопки быстрых подсказок ответов для пользователя.
- **Ответ (200 OK):**
  ```json
  {
    "message_id": "m4444444-eeee-aaaa-bbbb-cccccccccccc",
    "suggestions": [
      "Отличная идея, я в деле!",
      "К сожалению, я занят в это время.",
      "Давай обсудим это подробнее на созвоне."
    ]
  }
  ```

### `POST /api/v1/ai/chats/{chat_id}/summarize` — Автоматическое саммари чата

- **Назначение:** Формирует краткую выжимку по последним N сообщениям переписки.
- **Тело запроса (JSON):** `{ "messages_limit": 100 }`
- **Ответ (200 OK):**
  ```json
  {
    "chat_id": "c3333333-eeee-aaaa-bbbb-cccccccccccc",
    "summary": "Основные темы обсуждения:\n1. Команда согласовала внедрение новой архитектуры API.\n2. Иван обновил аватар группы.\n3. Решено провести интеграционный тест в понедельник.",
    "generated_at": "2026-10-03T09:26:00Z"
  }
  ```

---

## ⚡ 8. Протокол реального времени (WebSocket API)

**Подключение:** `ws://backend.com/ws?token=JWT_TOKEN`

### 📤 Исходящие события от клиента (Frontend -> Backend)

1. **`message:send`** — Отправка мгновенного сообщения:
   ```json
   {
     "event": "message:send",
     "data": { "chat_id": "uuid", "text": "Текст сообщения" }
   }
   ```
2. **`chat:typing`** — Сигнал о том, что пользователь пишет текст:
   ```json
   { "event": "chat:typing", "data": { "chat_id": "uuid" } }
   ```

### 📥 Входящие события от сервера (Backend -> Frontend)

1. **`message:new`** — Новое сообщение в чате (рассылка всем участникам):
   ```json
   {
     "event": "message:new",
     "data": { "id": "msg-uuid", "text": "Привет", "user_id": "uuid" }
   }
   ```
2. **`chat:updated`** — Мгновенное обновление параметров чата (название, аватар):
   ```json
   {
     "event": "chat:updated",
     "data": {
       "chat_id": "uuid",
       "title": "Новое название",
       "avatar_url": "..."
     }
   }
   ```
3. **`user:typing`** — Отображение статуса печати другого пользователя:
   ```json
   { "event": "user:typing", "data": { "chat_id": "uuid", "user_id": "uuid" } }
   ```
4. **`ai:typing`** — Сервер сообщает, что нейросеть начала генерировать ответ.
5. **`ai:stream_chunk`** — Потоковая передача сгенерированного ИИ текста по частям (токен за токеном):
   ```json
   {
     "event": "ai:stream_chunk",
     "data": {
       "chat_id": "uuid",
       "message_id": "ai-msg-uuid",
       "text_chunk": "Команда "
     }
   }
   ```

---
