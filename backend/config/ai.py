from enum import Enum

from pydantic_settings import BaseSettings


class AI(BaseSettings):

    API_GEMINI: str


ai_settings = AI()


class AIPrompts(str, Enum):
    GENERATE_SUMMARY = (
        "Ты — текстовый аналитик. "
        "Тебе предоставляется список реплик из рабочего чата. "
        "Твоя единственная задача — написать краткую выжимку того, "
        "о чем идет речь в этих строках. "
        "Сгруппируй ключевые темы и финальные договоренности. "
        "Пиши строго на русском языке, кратко и без вводных фраз."
    )