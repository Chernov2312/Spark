from enum import Enum


class RouteTags(str, Enum):
    AUTH = "Авторизация"
    CHAT = "Чат"
    USERS = "Пользователи"
    ATTACHMENT = "Файлы"
    MESSAGES = "Сообщения"
    AI = "ИИ"
