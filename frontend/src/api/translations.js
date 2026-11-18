/* Перевод ошибок с английского (FastAPI, Pydantic) на русский */

const ERROR_MAP = {
  // Общие
  "Not authenticated": "Требуется авторизация",
  "Not Found": "Ресурс не найден",
  "Internal Server Error": "Ошибка сервера",
  Forbidden: "Доступ запрещён",
  "Bad Request": "Некорректный запрос",
  "Method Not Allowed": "Метод не поддерживается",

  // Auth
  "Incorrect username or password": "Неверный логин или пароль",
  "Incorrect email or password": "Неверный email или пароль",
  "Inactive user": "Аккаунт деактивирован",
  "User already exists": "Пользователь уже существует",
  "Email already registered": "Email уже зарегистрирован",
  "Username already taken": "Имя пользователя занято",
  "Email уже занят": "Email уже зарегистрирован",
  "Имя пользователя занято": "Имя пользователя занято",

  // Валидация
  "field required": "Поле обязательно для заполнения",
  "value is not a valid email address": "Некорректный email",
  "value is not a valid integer": "Должно быть число",
  "string does not match regex": "Неверный формат",
  "ensure this value has at least 3 characters": "Минимум 3 символа",
  "ensure this value has at least 6 characters": "Минимум 6 символов",
  "ensure this value has at most 32 characters": "Максимум 32 символа",
  "ensure this value has at most 128 characters": "Максимум 128 символов",
  "password cannot be longer than 72 bytes": "Пароль слишком длинный",

  // Чаты
  "Chat not found": "Чат не найден",
  "You are not a member of this chat": "Вы не участник этого чата",
  "You are not the author": "Вы не автор",
  "User already in chat": "Пользователь уже в чате",
  "Poll not found": "Опрос не найден",
  "Option does not belong to this poll": "Этот вариант не относится к опросу",
  "This poll does not allow changing or retracting an answer": "В этом опросе нельзя изменить или отменить ответ",
  "Polls cannot be edited after creation": "Опубликованный опрос нельзя редактировать",
  "Polls cannot be forwarded": "Пересылка опросов недоступна",
  "Poll options must be unique": "Варианты ответа не должны повторяться",
  "Choose a correct answer for the quiz": "Отметьте правильный ответ для викторины",

  // Сообщения
  "Message not found": "Сообщение не найдено",
  "Cannot edit someone else message": "Нельзя редактировать чужое сообщение",
  "Cannot delete someone else message": "Нельзя удалить чужое сообщение",

  // Файлы
  "File too large": "Файл слишком большой",
  "Invalid file type": "Неподдерживаемый тип файла",
};

/* Точный перевод, если нашли в словаре.
   Иначе — как есть. */
function translateOne(text) {
  if (!text) return "";
  const trimmed = String(text).trim();
  return ERROR_MAP[trimmed] || trimmed;
}

/* Извлекает человеко-читаемое сообщение из ответа бэкенда.
   Обрабатывает:
   - строку { "detail": "..." }
   - массив Pydantic { "detail": [{loc, msg, type}] }
   - отсутствие ответа вообще */
export function translateApiError(err, fallback = "Что-то пошло не так") {
  // Нет ответа от сервера
  if (!err?.response) {
    if (err?.code === "ERR_NETWORK" || err?.message === "Network Error") {
      return "Не удалось подключиться к серверу. Проверьте соединение";
    }
    if (err?.code === "ECONNABORTED") {
      return "Сервер долго не отвечает. Попробуйте позже";
    }
    return fallback;
  }

  const status = err.response.status;
  const detail = err.response.data?.detail;

  // Строка
  if (typeof detail === "string") {
    return translateOne(detail);
  }

  // Массив Pydantic
  if (Array.isArray(detail) && detail.length > 0) {
    const first = detail[0];
    const field = Array.isArray(first.loc)
      ? first.loc[first.loc.length - 1]
      : "";
    const fieldNames = {
      username: "Имя пользователя",
      email: "Email",
      password: "Пароль",
      title: "Название",
      description: "Описание",
      text: "Текст",
      avatar: "Аватар",
      image: "Изображение",
      data_req: "Данные вложения",
    };
    const fieldRu = fieldNames[field] || field;
    const msg = translateOne(first.msg);
    return fieldRu ? `${fieldRu}: ${msg}` : msg;
  }

  // По статусу — если ничего другого
  const byStatus = {
    400: "Некорректный запрос",
    401: "Требуется авторизация",
    403: "Доступ запрещён",
    404: "Не найдено",
    409: "Конфликт данных",
    422: "Проверьте правильность заполнения полей",
    429: "Слишком много запросов. Попробуйте позже",
    500: "Ошибка сервера. Попробуйте позже",
    502: "Сервер временно недоступен",
    503: "Сервис недоступен",
  };

  return byStatus[status] || fallback;
}
