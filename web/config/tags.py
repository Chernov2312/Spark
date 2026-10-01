from enum import Enum


class RouteTags(str, Enum):
    AUTH = "Авторизация"
    CHAT = "Чат"
    USERS = "Пользователи"
    IMAGES = "Изображения"
