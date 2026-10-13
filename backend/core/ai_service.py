from google import genai
from google.genai import types
from google.genai.errors import APIError

from config import ai_settings


class AIService:

    def __init__(self, model_name="gemini-3.5-flash-lite"):
        self.client = genai.Client(api_key=ai_settings.API_GEMINI)
        self.model = model_name

    async def generate_text(self, prompt: str, system_instruction: str = None) -> str:
        config = types.GenerateContentConfig(
            temperature="0.3",
            system_instruction=system_instruction,
        )
        try:
            response = await self.client.aio.models.generate_content(
                model=self.model,
                contents=prompt,
                config=config,
            )
            return response.text or "Не удалось сгенерировать текст."
        except APIError as e:
            raise e
