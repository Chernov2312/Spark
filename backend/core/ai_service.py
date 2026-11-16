from openai import AsyncOpenAI

from config import ai_settings


class AIService:
    def __init__(
        self,
        model_name: str | None = None,
        ollama_base_url: str | None = None,
        client: AsyncOpenAI | None = None,
    ):
        self.model = model_name or ai_settings.OLLAMA_MODEL
        self.base_url = (
            ollama_base_url or ai_settings.OLLAMA_BASE_URL
        ).rstrip("/") + "/v1"
        self.client = client

    async def generate_text(
        self,
        prompt: str,
        system_instruction: str | None = None,
    ) -> str:
        messages = []
        if system_instruction:
            messages.append({"role": "system", "content": system_instruction})
        messages.append({"role": "user", "content": prompt})

        request = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.3,
        }

        if self.client:
            response = await self.client.chat.completions.create(**request)
        else:
            async with AsyncOpenAI(
                base_url=self.base_url,
                api_key="ollama",
                timeout=180,
            ) as client:
                response = await client.chat.completions.create(**request)

        return response.choices[0].message.content or "AI generation failed."
