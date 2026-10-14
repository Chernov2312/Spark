from enum import Enum


class RouteTags(str, Enum):
    AUTH = "Авторизация"
    CHAT = "Чат"
    USERS = "Пользователи"
    ATTACHMENT = "Файлы"
    MESSAGES = "Сообщения"
    REACTIONS = "Реакции"
    AI = "ИИ"
    HEALTH_TEST = "Тест запуска бэка"
