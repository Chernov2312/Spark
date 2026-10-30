# Frontend Spark — документация

Одностраничное приложение мессенджера **Spark** на React + Vite. Тёмная тема, роутинг, работа с REST API и WebSocket.

---

## 1. Стек

| Слой          | Технология                 |
| ------------- | -------------------------- |
| **Сборщик**   | Vite 5                     |
| **UI**        | React 18                   |
| **Роутинг**   | react-router-dom 7         |
| **HTTP**      | axios                      |
| **Стили**     | чистый CSS, CSS-переменные |
| **Состояние** | hooks + `localStorage`     |
| **Модули**    | ESM                        |

---

## 2. Быстрый старт

```bash
cd frontend
npm install
npm run dev
```

Открывается http://localhost:5174

### Переменные окружения

`frontend/.env`:

```
VITE_API_URL=http://localhost:8080/api/v1
```

`.env.example` — коммитится в репозиторий, содержит те же переменные.

### Скрипты

| Команда           | Что делает                 |
| ----------------- | -------------------------- |
| `npm run dev`     | Dev-сервер Vite, порт 5174 |
| `npm run build`   | Prod-сборка в `dist/`      |
| `npm run preview` | Просмотр `dist/` локально  |

---

## 3. Структура проекта

```
frontend/
├── .env                       # переменные окружения
├── .env.example
├── index.html
├── package.json
├── vite.config.js
├── public/
│   └── spark.svg              # логотип (favicon + mask-image)
└── src/
    ├── main.jsx               # монтирование React + BrowserRouter
    ├── App.jsx                # карта маршрутов
    ├── api/
    │   ├── index.js           # единая точка экспорта
    │   ├── client.js          # axios + токен + интерцепторы
    │   ├── auth.js            # register / login / logout
    │   └── users.js           # профиль, аватар
    ├── components/
    │   ├── Header.jsx         # шапка
    │   ├── RegisterForm.jsx   # форма регистрации
    │   ├── LoginForm.jsx      # форма входа
    │   ├── SparkLogo.jsx      # логотип через mask-image
    │   └── NotFound.jsx       # 404
    ├── pages/
    │   ├── HomePage.jsx
    │   ├── RegisterPage.jsx
    │   ├── RegisterDemoPage.jsx
    │   ├── LoginPage.jsx
    │   ├── ProfilePage.jsx    # /profile + demo
    │   ├── ChatsPage.jsx      # /chats, /chats/:chatId
    │   └── FaqPage.jsx
    └── styles/
        ├── index.css          # @import всех
        ├── base.css           # :root, *, body
        ├── header.css
        ├── register.css
        ├── home.css
        ├── profile.css
        ├── chats.css
        ├── faq.css
        ├── not-found.css
        └── animations.css
```

**Правила:**

- Компоненты — `PascalCase.jsx`, один компонент — один файл.
- API/утилиты — `camelCase.js`.
- CSS — `kebab-case.css` через `index.css`.

---

## 4. Маршруты

| Путь                | Компонент          | Доступ        | Что показывает             |
| ------------------- | ------------------ | ------------- | -------------------------- |
| `/`                 | `HomePage`         | публичный     | Лендинг                    |
| `/register`         | `RegisterPage`     | публичный     | Регистрация через API      |
| `/register-preview` | `RegisterDemoPage` | публичный     | Демо-регистрация (без API) |
| `/login`            | `LoginPage`        | публичный     | Вход                       |
| `/profile`          | `ProfilePage`      | **приватный** | Профиль через API          |
| `/profile-preview`  | `ProfilePage demo` | публичный     | Демо-профиль               |
| `/chats`            | `ChatsPage`        | **приватный** | Список чатов               |
| `/chats/:chatId`    | `ChatsPage`        | **приватный** | Конкретный чат             |
| `/features`         | `SimplePage`       | публичный     | Заглушка                   |
| `/download`         | `SimplePage`       | публичный     | Заглушка                   |
| `/faq`              | `FaqPage`          | публичный     | FAQ                        |
| `*`                 | `NotFound`         | публичный     | 404                        |

### Приватные маршруты

```jsx
function PrivateRoute({ children }) {
  return auth.isAuthenticated() ? children : <Navigate to="/login" replace />;
}
```

`isAuthenticated()` проверяет `localStorage.access_token`.

---

## 5. API

### `src/api/client.js`

```js
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: { "Content-Type": "application/json" },
});
```

**Интерцепторы:**

1. Запрос → `Authorization: Bearer <access_token>`.
2. Ответ → при `401` чистит токен и редиректит на `/login`.

**Экспорты:**

```js
setToken(t); // положить access_token
getToken(); // прочитать access_token
clearToken(); // удалить access_token и user
```

### `src/api/auth.js`

| Функция                                       | HTTP                  | Описание                      |
| --------------------------------------------- | --------------------- | ----------------------------- |
| `registerUser({ username, email, password })` | `POST /auth/register` | Сохраняет токен и user        |
| `loginUser({ email, password })`              | `POST /auth/login`    | Content-Type: form-urlencoded |
| `logoutUser()`                                | —                     | Чистит localStorage           |
| `getCurrentUser()`                            | —                     | Возвращает `user`             |
| `isAuthenticated()`                           | —                     | Есть ли токен                 |

### `src/api/users.js`

| Функция                           | HTTP                           |
| --------------------------------- | ------------------------------ |
| `getMe()`                         | `GET /users/me`                |
| `updateMe({ username?, email? })` | `PATCH /users/me`              |
| `uploadAvatar(file)`              | `POST /users/me/avatar`        |
| `deleteAvatar(url)`               | `POST /users/me/delete/avatar` |

### `src/api/index.js`

```js
export { api, setToken, getToken, clearToken } from "./client";
export * as auth from "./auth";
export * as users from "./users";
```

Использование:

```jsx
import { auth, users } from "../api";

await auth.loginUser({ email, password });
const me = await users.getMe();
```

---

## 6. Аутентификация

### Хранение токена

- `localStorage.access_token` — JWT, поле `access_token` из ответа бэкенда.
- `localStorage.user` — JSON `{ id, username, email }`.

### JWT

Payload:

```json
{ "sub": "u1111111-...", "exp": 1734000000 }
```

### Поток «регистрация → чаты»

1. Заполняется `RegisterForm`.
2. Валидация паролей и галочки.
3. `auth.registerUser({ username, email, password })`.
4. Ответ `{ id, username, email, access_token, token_type }`.
5. `setToken(access_token)`.
6. Редирект на `/chats`.

### Поток «логин → чаты»

1. `LoginForm` → `POST /auth/login` (form-urlencoded).
2. `200` — токен в localStorage, редирект на `/chats`.
3. `401` — «Неверный email или пароль».

### Logout

```jsx
auth.logoutUser();
setUser(null);
navigate("/login");
```

---

## 7. Компоненты

### `Header.jsx`

Меняет содержимое по авторизации:

| Гость                       | Авторизованный      |
| --------------------------- | ------------------- |
| Возможности / Скачать / FAQ | Чаты / Профиль      |
| Войти / Начать бесплатно    | `@username` / Выйти |

`user` берётся из `auth.getCurrentUser()`.

### `RegisterForm.jsx`

| Проп              | Тип      | Описание         |
| ----------------- | -------- | ---------------- |
| `onSuccess(data)` | function | После успеха     |
| `demo`            | boolean  | Имитация без API |

**Поля:** `username`, `email`, `password`, `passwordRepeat`, `consent`.

**Валидация:**

- Пароли совпадают.
- Галочка согласия.
- Пароль ≥ 6, username ≥ 3.

### `LoginForm.jsx`

| Проп              | Тип      |
| ----------------- | -------- |
| `onSuccess(data)` | function |

**Поля:** `email`, `password`.

### `SparkLogo.jsx`

| Проп        | По умолчанию   |
| ----------- | -------------- |
| `size`      | 28             |
| `color`     | `currentColor` |
| `className` | `''`           |

```jsx
<SparkLogo size={26} color="#fff" />
```

### `NotFound.jsx`

Показывает путь и кнопки «На главную» / «Создать аккаунт».

---

## 8. Страницы

### `HomePage.jsx` — `/`

Hero, две кнопки, три карточки фич.

### `RegisterPage.jsx` — `/register`

Обёртка `RegisterForm`, `onSuccess` → `/chats`.

### `LoginPage.jsx` — `/login`

Обёртка `LoginForm` + ссылка на `/register`.

### `ProfilePage.jsx` — `/profile` и `/profile-preview`

VK-стиль: обложка, круглый аватар, имя, табы.

| Проп   | Тип     | Описание                      |
| ------ | ------- | ----------------------------- |
| `demo` | boolean | Данные из `DEMO_USER` без API |

**Функции:**

- Загрузка профиля (`GET /users/me`).
- Смена аватара (`POST /users/me/avatar`).
- Удаление аватара (`POST /users/me/delete/avatar`).
- Редактирование (`PATCH /users/me`).
- Табы: Информация / Друзья / Фото.

### `ChatsPage.jsx` — `/chats`

Слева список чатов, справа переписка. Сейчас на встроенных `MOCK_CHATS` / `MOCK_MESSAGES`.

Когда бэкенд готов — заменить на:

- `chats.listChats()` → `GET /chats`
- `messages.listMessages(chatId)` → `GET /chats/{id}/messages`
- `messages.sendMessage(chatId, text)` → `POST /chats/{id}/messages`

### `FaqPage.jsx` — `/faq`

Аккордеон из 10 вопросов. Плавная анимация раскрытия через `grid-template-rows: 0fr → 1fr`.

Ответы — простые строки в массиве `FAQ_ITEMS`.

---

## 9. Стили

### Переменные

```css
:root {
  --bg: #0a0a0f;
  --bg-elevated: #131319;
  --bg-input: #0f0f15;
  --border: #26262f;
  --border-focus: #7c6cff;
  --text: #f1f2f6;
  --text-muted: #8d92a3;
  --spark: #7c6cff;
  --spark-hover: #6a58f0;
  --spark-dim: rgba(124, 108, 255, 0.14);
  --danger: #ff6b6b;
  --success: #4ade80;
}
```

### Подключение

`main.jsx`:

```jsx
import "./styles/index.css";
```

`index.css`:

```css
@import "./base.css";
@import "./header.css";
@import "./register.css";
@import "./home.css";
@import "./profile.css";
@import "./chats.css";
@import "./faq.css";
@import "./not-found.css";
@import "./animations.css";
```

`base.css` — первым (там `:root`). `animations.css` — последним.

### Палитра

| Токен           | Значение  | Где             |
| --------------- | --------- | --------------- |
| `--bg`          | `#0a0a0f` | Фон страниц     |
| `--bg-elevated` | `#131319` | Карточки, шапка |
| `--bg-input`    | `#0f0f15` | Поля ввода      |
| `--spark`       | `#7c6cff` | Акцент, кнопки  |
| `--danger`      | `#ff6b6b` | Ошибки          |
| `--success`     | `#4ade80` | Успех           |

---

## 10. Анимации

### FAQ — раскрытие

```css
.faq-item__collapsible {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.faq-item--open .faq-item__collapsible {
  grid-template-rows: 1fr;
}

.faq-item__answer {
  overflow: hidden;
}
```

Grid сам считает высоту — работает с любой длиной ответа.

### Табы в профиле

```css
.vk-tab-content {
  animation: tabFadeIn 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes tabFadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

В JSX — `key={tab}`, чтобы React пересоздавал блок и animation срабатывал заново.

### Каскадное появление строк

```css
.vk-info-row:nth-child(1) {
  animation-delay: 0.05s;
}
.vk-info-row:nth-child(2) {
  animation-delay: 0.1s;
}
.vk-info-row:nth-child(3) {
  animation-delay: 0.15s;
}
```

### Ховеры

- Кнопки — `translateY(-1px)` + цвет.
- Аватар — `scale(1.03)` + тень.
- Карточки фич — `translateY(-2px)` + рамка.

---

## 11. Демо-режим

Два публичных маршрута для работы без бэкенда:

| Маршрут             | Что показывает               |
| ------------------- | ---------------------------- |
| `/register-preview` | Форма регистрации в имитации |
| `/profile-preview`  | Профиль с `DEMO_USER`        |

Компоненты принимают проп `demo`:

- `demo={false}` — реальные запросы.
- `demo={true}` — локальные данные.

**Зачем:**

- Разработка UI без бэкенда.
- Демонстрация интерфейса.
- Обход CORS-проблем.

**Ограничения:**

- Данные не сохраняются на сервере.
- Токен фиктивный.
- Аватар живёт до перезагрузки.

---

## 12. Типичные ошибки

| Ошибка                     | Причина                                 | Решение                                     |
| -------------------------- | --------------------------------------- | ------------------------------------------- |
| `Failed to resolve import` | Опечатка / файла нет                    | Проверить `dir src\...`                     |
| `X is not defined`         | Забыл импорт                            | Добавить `import X`                         |
| `Invalid hook call`        | Разные версии React и роутера           | `npm install react-router-dom@latest`       |
| `CORS policy`              | Бэкенд не разрешил origin               | `CORSMiddleware` с `http://localhost:5174`  |
| `ERR_CONNECTION_REFUSED`   | Бэкенд не запущен                       | `uvicorn app.main:app --reload --port 8080` |
| Стили не применяются       | `index.css` не импортирован             | Проверить `main.jsx`                        |
| `VITE_API_URL` undefined   | `.env` не в корне / Vite не перезапущен | `.env` → `frontend/`, перезапуск            |
| 401 на приватном роуте     | Токен протух                            | Залогиниться заново                         |
| 422 на регистрации         | Поля не совпадают со схемой             | Сверить с `API.md`                          |

---

## 13. Сборка и деплой

### Production build

```bash
cd frontend
npm run build
```

Результат — `frontend/dist/`.

### Локальный просмотр

```bash
npm run preview
```

http://localhost:4173

### Деплой

`dist/` — статика. Кладётся на Nginx, Caddy, Vercel, Netlify, Cloudflare Pages.

**Для SPA-роутинга** нужен fallback на `index.html`:

**Nginx:**

```nginx
location / { try_files $uri $uri/ /index.html; }
```

**Netlify** — `_redirects`:

```
/* /index.html 200
```

**Vercel** — `vercel.json`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

### Production `.env`

```
VITE_API_URL=https://api.spark.example.com/api/v1
```

Переменные с префиксом `VITE_` инлайнятся в бандл.

---

## 14. Что дальше

Фронт покрывает MVP: лендинг, регистрация, вход, профиль, чаты (на моках), FAQ, 404.

Следующие шаги:

1. **Чаты через API** — заменить `MOCK_CHATS` / `MOCK_MESSAGES`.
2. **WebSocket** — `ws://localhost:8080/ws?token=...`.
3. **Реакции** — эмодзи на сообщениях.
4. **Загрузка изображений** — `POST /images/upload`.
5. **Smart Replies и саммари** — AI-эндпоинты.
6. **Создание чатов** — модальное окно `POST /chats`.
7. **Уведомления** — Web Notifications + счётчик.
8. **Тема light/dark** — переключатель + второй набор переменных.
9. **PWA** — манифест, service worker.

---

## 15. Связанные документы

- **`API.md`** — спецификация эндпоинтов бэкенда (REST + WebSocket).
- **`README.md`** — общее описание проекта и инструкция запуска.
