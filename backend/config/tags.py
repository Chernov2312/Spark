from enum import StrEnum


class RouteTags(StrEnum):
    AUTH = "Авторизация"
    CHAT = "Чат"
    USERS = "Пользователи"
    ATTACHMENT = "Файлы"
    MESSAGES = "Сообщения"
    REACTIONS = "Реакции"
    AI = "ИИ"
    HEALTH_TEST = "Тест запуска бэка"
