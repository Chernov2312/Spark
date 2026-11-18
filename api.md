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

Вход принимает `application/x-www-form-urlencoded` (или `multipart/form-data`) с полями `username` и `password`. В поле `username` передаётся адрес электронной почты (до 100 символов); регистр адреса и пробелы по краям игнорируются. Вход по тегу или имени пользователя не поддерживается.

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

Общее фото чата могут менять только владелец и модераторы. Для обычных участников кнопка загрузки скрыта; запрос временной ссылки с `type: "chat_avatar"` и регистрация вложения с `chat_id` и `is_avatar: true` возвращают `403 Forbidden`. При отсутствии чата возвращается `404`, при некорректном UUID в `target_id` — `422`. Права проверяются заново при регистрации, даже если ссылка была выдана до понижения роли. Личная картинка чата по-прежнему доступна любому участнику.

### `GET /api/v1/chats`

`personal_avatar_url` — подписанная ссылка на личную картинку чата для текущего пользователя или `null`, если используется общая. Картинки других пользователей не возвращаются.

Возвращает список чатов текущего пользователя (`200 OK`):

Каждый чат содержит `last_message`: `null` для пустого чата либо объект с `id`, `user_id`, `text`, `created_at`, `thread_root_id` и `attachments` (только `file_name` и `mime_type`). Последнее сообщение выбирается по времени из PostgreSQL и очереди Redis, включая ответы в тредах.

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

### `GET /api/v1/chats/{chat_id}/members`

Доступен только участникам чата; для отсутствующего чата или постороннего пользователя возвращает `404`. Возвращает массив участников, упорядоченный по роли (владелец, модераторы, участники), затем по имени:

```json
[
  {
    "id": "11111111-eeee-aaaa-bbbb-cccccccccccc",
    "username": "Анна",
    "tag": "anna",
    "role": "owner",
    "last_read_message_id": null,
    "avatar_urls": [],
    "created_at": "2026-01-01T12:00:00"
  }
]
```

`created_at` — дата регистрации пользователя. `avatar_urls` содержит временные подписанные ссылки на фотографии профиля в порядке создания, от старых к новым; последняя используется как аватар. Общие аватары чатов не включаются. Email и другие приватные поля не возвращаются. Frontend использует эти данные для списка участников и карточки профиля.

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

### Личная картинка чата

Для загрузки запросите `POST /api/v1/attachments/temporary-url` с `type: "personal_chat_avatar"`, UUID чата в `target_id`, `file_content` (MIME изображения) и `file_extension`. Доступ есть у любого участника чата. Загрузите файл через `PUT` на выданный `temporary_url`, затем сохраните выбор:

- `PUT /api/v1/chats/{chat_id}/personal-avatar` — тело `{"file_key": "ключ из шага загрузки"}`; проверяет принадлежность ключа пользователю и чату, наличие объекта, MIME и размер до 5 МБ.
- `DELETE /api/v1/chats/{chat_id}/personal-avatar` — возвращает общую картинку.

Оба маршрута возвращают `{"personal_avatar_url": "подписанная ссылка или null"}`. Настройка хранится в `chat_appearances` с уникальной парой `(user_id, chat_id)` и удаляется при удалении участия в чате. Личная картинка не публикуется в общий WebSocket и не меняет общие `avatar_urls`.

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

Для ответа в треде передайте необязательный `thread_root_id` — UUID корневого сообщения в этом чате. `reply_to_id` сохраняет отдельное значение цитаты и может использоваться вместе с ним.

Ответ содержит `id`, `chat_id`, `user_id`, `text`, `user_reaction`, `attachments`, `reactions_count` и `created_at`. Схема `AttachmentRequest` задает `file_key`, тогда как обработчик формирует вложения ответа с `attachment_url`; проверьте фактический ответ после исправления этого несоответствия.

### `GET /api/v1/chats/{chat_id}/messages/{root_message_id}/thread`

Возвращает корневое сообщение и ответы в треде по возрастанию времени. `limit` ограничен 200 ответами; `before` загружает более ранние ответы. Ответы треда не включаются в основную историю чата. Доступен только участникам чата; корень должен быть сообщением верхнего уровня.

### `GET /api/v1/chats/{chat_id}/threads`

Возвращает `{"messages": [...]}` со всеми корневыми сообщениями тредов чата, у которых есть ответы, включая сообщения из очереди Redis. Требует участия в чате. Корни содержат `thread_reply_count`.

### `POST /api/v1/chats/{chat_id}/messages/{message_id}/forward`

Тело: `{"target_chat_id": "UUID"}`. Требует участия в исходном и целевом чатах. Создаёт отдельное сообщение с копией текста и записей вложений; вложения получают новые ID и целевой `chat_id`, сохраняя ключ объекта хранилища. Работает и для исходного сообщения, ожидающего записи из Redis. Возвращает новое сообщение (`201`) и публикует `message:new` в целевой чат. Цитата и принадлежность исходному треду не копируются.

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

### Закреплённые сообщения

`GET /api/v1/chats/{chat_id}/messages/pinned` возвращает `{"messages": [...]}` с полными объектами `MessageResponse`, включая `is_pinned: true`, вложения и `thread_root_id` для ответов в тредах. Сообщения упорядочены по времени закрепления, от новых к старым; список не ограничен страницей истории. Доступен только участникам: `403` для постороннего пользователя, `404` для отсутствующего чата.

`PUT /api/v1/chats/{chat_id}/messages/{message_id}/pin` переключает закрепление и возвращает `{"pinned": true}` или `{"pinned": false}`. Участники чата получают событие `message:updated` с полным сообщением и актуальным `is_pinned`. Кеш истории инвалидируется. Поиск, история, треды и редактирование сохраняют корректный признак `is_pinned`.

### Опросы и викторины

`POST /api/v1/chats/{chat_id}/polls` создаёт сообщение с опросом, ответ — `201 Created` с `MessageResponse`. Поле `poll_id` присутствует в истории, поиске, тредах, закреплениях и событии `message:new`; у обычных сообщений оно `null`.

```json
{
  "question": "Какой вариант верный?",
  "options": ["Первый", "Второй", "Третий"],
  "is_anonymous": true,
  "allow_retract": false,
  "is_quiz": true,
  "correct_option_index": 1,
  "thread_root_id": null
}
```

Вопрос — 1–300 символов после обрезки пробелов, вариантов — 2–10, каждый 1–150 символов. Пустые и повторяющиеся варианты запрещены. `is_anonymous` и `allow_retract` по умолчанию `true`, `is_quiz` — `false`. Для викторины обязателен `correct_option_index` (индекс с нуля); для обычного опроса он должен быть `null` или отсутствовать. Голосование всегда с выбором одного варианта. `thread_root_id` позволяет создать опрос в треде текущего чата.

- `GET /api/v1/polls/{poll_id}` — персональное состояние опроса.
- `PUT /api/v1/polls/{poll_id}/vote` — голосование, тело `{"option_id": "UUID варианта"}`.
- `DELETE /api/v1/polls/{poll_id}/vote` — отмена ответа.

Все три маршрута возвращают `PollResponse`: `id`, `message_id`, `chat_id`, `question`, `is_anonymous`, `allow_retract`, `is_quiz`, `is_creator`, `total_votes`, `my_option_id`, `correct_option_id`, `version` и `options`. Каждый вариант содержит `id`, `text`, `votes_count`, `voters`. Для анонимного опроса `voters: null` у всех вариантов, в том числе для автора; для открытого — массив `{id, username, tag}`. `my_option_id` описывает только ответ запрашивающего пользователя. Правильный вариант викторины скрыт до голосования (`correct_option_id: null`); автор видит его сразу. Отмена разрешённого голоса снова скрывает правильный вариант, но уже полученную информацию нельзя отозвать: в таком режиме пользователь может ответить заново после оценки.

Если `allow_retract: false`, смена и отмена уже поданного ответа возвращают `409 Conflict`. Повтор того же ответа идемпотентен и не добавляет голосов. Уникальность голоса гарантируется БД; параллельные запросы сериализуются блокировкой опроса. Вариант из другого опроса возвращает `422`. Доступ только участникам чата (`403` для постороннего); отсутствующий опрос возвращает `404`.

После изменения голосов участники получают:

```json
{
  "event": "poll:updated",
  "data": {
    "chat_id": "UUID чата",
    "poll_id": "UUID опроса",
    "message_id": "UUID сообщения",
    "version": 2
  }
}
```

Общее событие не содержит имён, выбранных вариантов или правильного ответа. Клиент перечитывает персональное состояние через `GET /polls/{poll_id}`. `version` растёт при изменении голосов и позволяет обработать гонку события с фиксацией транзакции.

Опросы сохраняются в `polls`, `poll_options`, `poll_votes`; удаление сообщения каскадно удаляет опрос и голоса. Редактирование и пересылка сообщения с опросом возвращают `422`; ответы, треды, закрепление и удаление автором поддерживаются. Миграция: `e8c2a490b517_chat_polls`.

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

При `type: "chat_avatar"` ответ содержит UUID существующего чата из `target_id` в поле `chat_id`; ключ имеет префикс `chat_avatar/{chat_id}/`. Ссылка выдаётся только владельцу или модератору. При `type: "personal_chat_avatar"` возвращаются оба идентификатора, а при `message` и `user_avatar` — `user_id`. Реализация использует временную ссылку как URL для HTTP `PUT`.

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

Для регистрации общего аватара передайте `chat_id` и `is_avatar: true`. Сервер повторно проверяет права владельца или модератора перед созданием вложения. Для личной картинки чата используйте отдельные маршруты `/chats/{chat_id}/personal-avatar`.

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

## 9. Звонки: взаимодействие Go- и Python-сервисов

Этот раздел описывает контракт звонков и будущих гостевых ссылок. Go-сервис сигналинга и его маршруты пока не реализованы; события и маршруты ниже — проектируемый протокол, а не доступная часть текущего API.

### Ответственность сервисов

- **Python (текущий backend)** остается источником данных для пользователей, JWT, чатов и членства. Go не подключается напрямую к Python-базе данных.
- **Go (планируемый сервис звонков)** держит WebSocket-сессии, проверяет право пользователя звонить в чат, создает и завершает звонки и пересылает между участниками WebRTC-сигналинг (`offer`, `answer`, ICE-кандидаты). Временное состояние звонка хранится в Go/Redis и не становится историей чата.
- **Браузеры** передают аудио и видео напрямую друг другу через WebRTC. Go не проксирует медиапоток. Для сетей, где прямое соединение невозможно, нужны настроенные STUN/TURN-серверы; их ICE-конфигурация передается клиентам при `auth:ok` или `call:started`.

### Аутентификация и проверка участников

Фронтенд открывает отдельный WebSocket, заданный через `VITE_CALLS_WS_URL` (например, `ws://localhost:8002/v1/calls/ws`; в production — `wss://...`). Первым сообщением он отправляет:

```json
{
  "event": "auth",
  "data": { "access_token": "<JWT>" }
}
```

Рекомендуемый способ для Go подтвердить идентичность без общей базы — вызвать Python по внутреннему адресу с тем же токеном:

1. `GET /api/v1/users/me` с `Authorization: Bearer <JWT>`: Python валидирует токен и возвращает UUID пользователя.
2. Перед созданием или принятием звонка Go вызывает `GET /api/v1/chats/{chat_id}/members` с тем же заголовком. Этот существующий маршрут возвращает `404`, если запрашивающий пользователь не участник чата. Go сверяет UUID из списка с UUID пользователя из шага 1.
3. При успехе Go отвечает `auth:ok`; при отказе — `auth:error` с `message` и закрывает соединение. Проверку членства нужно делать для каждого нового звонка и для принимающего участника. Список из Python также позволяет Go доставить приглашение только активным WebSocket-сессиям пользователей этого чата. Короткий кэш допустим только с учетом требований к немедленному отзыву доступа.

Это взаимодействие использует уже описанные Python-маршруты. Новые Python-маршруты для звонков не требуются. Go должен обращаться к Python по внутренней сети, а не публиковать служебные запросы наружу.

### Временные ссылки для гостей

Ссылка приглашает в конкретный уже начатый звонок. Она не создает аккаунт и не дает гостю доступ к чату, сообщениям, списку участников или REST API.

#### POST `/v1/calls/{call_id}/invites` — создать ссылку

Маршрут Go-сервиса. Требует `Authorization: Bearer <JWT>`. Go проверяет пользователя через `GET /api/v1/users/me`, получает список участников и их роли через `GET /api/v1/chats/{chat_id}/members`, затем разрешает выпуск ссылки владельцу или модератору чата. `call_id` должен обозначать активный звонок в этом чате.

Запрос:

```json
{
  "expires_in_seconds": 3600,
  "max_uses": 5
}
```

`expires_in_seconds` — от 60 до 86400 секунд (по умолчанию 3600); `max_uses` — от 1 до 20 успешных подключений (по умолчанию 5).

Ответ `201 Created`:

```json
{
  "invite_id": "55555555-eeee-aaaa-bbbb-cccccccccccc",
  "invite_url": "https://app.example.com/call/join#invite=<opaque-token>",
  "expires_at": "2026-11-16T14:00:00Z",
  "max_uses": 5
}
```

Go генерирует криптографически случайный токен не менее чем из 256 бит, а в Redis хранит только его хеш и ограничения: `call_id`, `chat_id`, создателя, время истечения, лимит подключений и число использований. Сам токен нельзя писать в логи или возвращать повторно по `invite_id`. В примере он находится во fragment URL, поэтому не отправляется в HTTP-запросе к фронтенду и не попадает в access-логи reverse proxy. Клиент извлекает фрагмент и удаляет его из адресной строки через `history.replaceState`. Ссылка перестает работать по достижении срока, лимита использований, завершении звонка или после отзыва.

#### DELETE `/v1/calls/invites/{invite_id}` — отозвать ссылку

Маршрут Go-сервиса, также требует JWT. Создатель ссылки, владелец или модератор чата может отозвать ее. Успешный ответ — `204 No Content`; отсутствующая или уже отозванная ссылка — `404 Not Found`.

#### Подключение незарегистрированного гостя

Клиент будущего guest join-flow открывает URL вида `/call/join#invite={token}`, извлекает токен из fragment и подключает звонковый WebSocket. Этот frontend-маршрут пока не реализован. Вместо JWT он отправляет первым кадром:

```json
{
  "event": "auth",
  "data": {
    "invite_token": "<opaque-token>"
  }
}
```

Для `auth.data` клиент передает ровно одно из полей: `access_token` или `invite_token`. Go проверяет токен и активность звонка; гостевой токен разрешает подключение только к указанному `call_id`. При успехе ответ содержит `guest: true`, `call_id` и `ice_servers`:

```json
{
  "event": "auth:ok",
  "data": {
    "guest": true,
    "call_id": "44444444-eeee-aaaa-bbbb-cccccccccccc",
    "ice_servers": []
  }
}
```

До принятия звонка токен не расходуется: Go атомарно, с проверкой лимита, увеличивает счетчик только при успешной обработке `call:accept`. Превышение лимита, истекшая ссылка, завершенный звонок или отзыв дают `auth:error` либо `call:error` с машинным `code` и безопасным для показа `message`.

У гостя Go создает временный `peer_id` и отображаемое имя `Гость N`; передавать имя или другие персональные данные не требуется. При `call:peer_joined` Go добавляет `participant_type: "guest"`. Гостевой участник может передавать только WebRTC-сигналинг в рамках приглашенного звонка. Его `call:end` отключает только его самого; завершить звонок для всех может только создатель звонка или уполномоченный участник.

Python не хранит гостевую учетную запись и не меняет свои маршруты: он используется Go только для проверки создателя приглашения и его роли. Не помещайте JWT, данные чата или другие полномочия в URL; в ссылке должен находиться только случайный ограниченный токен.

### События WebSocket сервиса звонков

Все сообщения имеют вид `{"event": "...", "data": {...}}`. Go добавляет `from_id` к ретранслируемым сигналам и проверяет, что `call_id` и `target_id` относятся к активному звонку и его участникам.

| Направление | Событие | Поля `data` | Назначение |
| --- | --- | --- | --- |
| Клиент → Go | `call:start` | `chat_id`, `media` (`audio` или `video`) | Создать звонок после проверки членства. Браузер до этого запрашивает доступ к микрофону/камере. |
| Go → инициатор | `call:started` | `call_id`, `chat_id`, `media`, `ice_servers` | Подтвердить создание звонка и вернуть ICE-серверы. |
| Go → остальные участники | `call:incoming` | `call_id`, `chat_id`, `caller_name`, `media` | Показать входящий вызов подключенным участникам чата. |
| Клиент → Go | `call:accept` / `call:decline` | `call_id` | Принять или отклонить вызов. Принимающий должен быть участником чата либо предъявить действительную гостевую ссылку именно на этот звонок. |
| Go → участники | `call:accepted` | `call_id`, `peer_id` | Уведомить об ответе на вызов. |
| Go → участники | `call:peer_joined` | `call_id`, `peer_id`, `display_name`, `should_offer`, `participant_type` (`user` или `guest`) | Объявить подключившегося участника; `should_offer` выбирает сторону, создающую offer. |
| Клиент → Go → участник | `rtc:offer` / `rtc:answer` | `call_id`, `target_id`, `sdp` | Передать SDP-предложение или ответ. При пересылке Go добавляет `from_id`. |
| Клиент → Go → участник | `rtc:ice` | `call_id`, `target_id`, `candidate` | Передать ICE-кандидат. При пересылке Go добавляет `from_id`. |
| Клиент → Go | `call:end` | `call_id` | Завершить звонок для текущего пользователя. |
| Go → участники | `call:peer_left` / `call:ended` | `call_id`, `peer_id` (для `peer_left`) | Уведомить об отключении участника или завершении звонка. |
| Go → клиент | `call:declined` / `call:error` | `call_id`, `message` | Сообщить об отклонении вызова или ошибке. |

Ответ `auth:ok` может содержать список `ice_servers` в формате WebRTC:

```json
{
  "event": "auth:ok",
  "data": {
    "ice_servers": [
      { "urls": ["stun:stun.example.net:3478"] },
      {
        "urls": ["turn:turn.example.net:3478"],
        "username": "<временный-пользователь>",
        "credential": "<временный-пароль>"
      }
    ]
  }
}
```

TURN-учетные данные должны быть временными. Секреты TURN и адрес внутреннего Python API задаются конфигурацией Go-сервиса и не включаются в frontend bundle.

### Последовательность соединения

```mermaid
sequenceDiagram
    participant A as Браузер A
    participant G as Go: signaling
    participant P as Python: REST API
    participant B as Браузер B
    participant X as Браузер гостя
    A->>G: WebSocket + auth(JWT)
    G->>P: GET /users/me (Bearer JWT)
    P-->>G: UUID пользователя
    G-->>A: auth:ok + ICE servers
    A->>G: call:start(chat_id, media)
    G->>P: GET /chats/{chat_id}/members (Bearer JWT)
    P-->>G: список участников / отказ
    G-->>A: call:started
    G-->>B: call:incoming
    B->>G: call:accept
    G-->>A: call:peer_joined
    A->>G: POST /v1/calls/{call_id}/invites
    G-->>A: invite_url + expires_at
    Note over A,X: Ссылка передается гостю вне чата
    X->>G: WebSocket + auth(invite_token)
    G-->>X: auth:ok(guest, call_id, ICE servers)
    X->>G: call:accept
    G-->>A: call:peer_joined(participant_type=guest)
    A->>G: rtc:offer + ICE
    G->>X: rtc:offer + ICE
    X->>G: rtc:answer + ICE
    G->>A: rtc:answer + ICE
    A->>X: WebRTC audio/video (или через TURN)
    X->>A: WebRTC audio/video (или через TURN)
```

В production reverse proxy направляет `/api/v1/*` в Python, а `VITE_CALLS_WS_URL` — в Go с поддержкой WebSocket upgrade. В локальной разработке адрес Go задается отдельно от `VITE_API_URL`. Текущая Python chat-WebSocket `/{chat_id}/ws` предназначена для сообщений и не является транспортом звонков. Браузер запрашивает разрешения на микрофон и камеру; вне `localhost` интерфейс должен работать по HTTPS, иначе `getUserMedia` недоступен.
