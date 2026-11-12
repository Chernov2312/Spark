import httpx
from google import genai
from google.genai import types
from google.genai.errors import APIError

from config import ai_settings


class AIService:
    def __init__(
        self,
        model_name: str = "gemini-3.5-flash-lite",
        ollama_base_url: str | None = None,
    ):
        self.model = model_name
        self.ollama_base_url = ollama_base_url.rstrip("/") if ollama_base_url else None
        self.client = (
            None if self.ollama_base_url else genai.Client(api_key=ai_settings.API_GEMINI)
        )

    async def generate_text(
        self,
        prompt: str,
        system_instruction: str | None = None,
    ) -> str:
        if self.ollama_base_url:
            messages = []
            if system_instruction:
                messages.append({"role": "system", "content": system_instruction})
            messages.append({"role": "user", "content": prompt})
            async with httpx.AsyncClient(timeout=180) as client:
                response = await client.post(
                    f"{self.ollama_base_url}/api/chat",
                    json={
                        "model": self.model,
                        "messages": messages,
                        "options": {"temperature": 0.3},
                        "stream": False,
                        "think": False,
                    },
                )
                response.raise_for_status()
            return response.json()["message"]["content"] or "AI generation failed."

        config = types.GenerateContentConfig(
            temperature=0.3,
            system_instruction=system_instruction,
        )
        try:
            response = await self.client.aio.models.generate_content(
                model=self.model,
                contents=prompt,
                config=config,
            )
            return response.text or "AI generation failed."
        except APIError as error:
            raise error
