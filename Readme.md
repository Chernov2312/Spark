# Spark
[![Linter](https://github.com/Chernov2312/Spark/actions/workflows/ci_linter_test.yml/badge.svg)](https://github.com/Chernov2312/Spark/actions/workflows/ci_linter_test.yml)
[![Python Test](https://github.com/Chernov2312/Spark/actions/workflows/ci_python_test.yml/badge.svg)](https://github.com/Chernov2312/Spark/actions/workflows/ci_python_test.yml)
## 🛠 Необходимое ПО

Перед запуском проекта убедитесь, что у вас установлены:

* 🐋 [**Docker** (версия 20.10 или выше)](https://docs.docker.com/desktop/setup/install/windows-install/)

---

## 🚀 Инструкция по запуску

Проект полностью контейнеризирован. Запуск базы данных, создание таблиц и старт приложения происходят автоматически.

### 1. Подготовка окружения
Скопируйте шаблон конфигурации в рабочий файл `.env`:

```bash
cp env.example .env
```

*После копирования вы можете открыть файл `.env` и отредактировать доступы к базе данных, если дефолтные вам не подходят.*

### 2. Запуск проекта
Выполните следующую команду в корневой директории:

```bash
docker-compose up --build
```

#### Подвал
```mermaid
erDiagram
    users {
        uuid id PK
        timestamp created_at
        timestamp updated_at
        string username UK
        string password
        string email UK
    }

    chats {
        uuid id PK
        timestamp created_at
        timestamp updated_at
        uuid author_id FK
        string title UK
        string description
    }

    user_chat {
        uuid user_id PK, FK
        uuid chat_id PK, FK
    }

    messages {
        uuid id PK
        timestamp created_at
        timestamp updated_at
        uuid user_id FK
        uuid chat_id FK
        string text
        jsonb reactions_count
    }

    messagereactions {
        uuid id PK
        timestamp created_at
        timestamp updated_at
        uuid user_id FK
        uuid message_id FK
        string emoji
    }

    images {
        uuid id PK
        timestamp created_at
        timestamp updated_at
        string image_url
        uuid user_id FK
        uuid chat_id FK
    }

    %% Отношения и связи между таблицами
    users ||--o{ chats : "создает (автор)"
    users ||--o{ user_chat : "состоит в"
    chats ||--o{ user_chat : "включает"
    
    users ||--o{ messages : "отправляет"
    chats ||--o{ messages : "содержит"
    
    users ||--o{ messagereactions : "оставляет"
    messages ||--o{ messagereactions : "получает"
    
    users ||--o{ images : "имеет аватары"
    chats ||--o{ images : "имеет аватары"
```

----
#### Разработчики

*  **Булычев Владимир** — Основатель идеи / Backend-разработчик
*  **Чернов Максим** — Тимлид / Ведущий Backend-разработчик
*  **Малыгин Артём** — Профессиональный вайбкодер / Frontend-разработчик
