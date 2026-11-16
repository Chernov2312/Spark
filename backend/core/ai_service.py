from collections.abc import Sequence
from typing import Protocol
import uuid

from fastapi import HTTPException, status
from openai import AsyncOpenAI
from sqlalchemy.ext.asyncio import AsyncSession

from config import ai_settings
from db.dao.chat_dao import ChatDao
from db.dao.message_dao import MessageDao
from infrastructure.redis.client import Redis
from infrastructure.redis.message_queue import history_cache_key
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import MessageHistory

MAX_CONTEXT_CHARS = 30_000


class ContextAttachment(Protocol):
    @property
    def file_name(self) -> str: ...

    @property
    def text(self) -> str | None: ...


class ContextMessage(Protocol):
    @property
    def user_id(self) -> uuid.UUID: ...

    @property
    def text(self) -> str | None: ...

    @property
    def attachments(self) -> Sequence[ContextAttachment]: ...


class AIService:
    def __init__(
        self,
        model_name: str | None = None,
        ollama_base_url: str | None = None,
        client: AsyncOpenAI | None = None,
    ) -> None:
        self.model = model_name or ai_settings.OLLAMA_MODEL
        self.base_url = (ollama_base_url or ai_settings.OLLAMA_BASE_URL).rstrip(
            "/"
        ) + "/v1"
        self.client = client

    async def ensure_chat_member(
        self,
        session: AsyncSession,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        chat = await ChatDao.get_chat_with_users(session=session, chat_id=chat_id)
        if chat is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Chat not found",
            )
        if not any(member.id == user_id for member in chat.users):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not a member of this chat",
            )

    async def get_recent_messages(
        self,
        *,
        session: AsyncSession,
        redis: Redis,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int,
    ) -> Sequence[ContextMessage]:
        version = await RedisDao.get_history_version(redis, chat_id)
        cache_limits = sorted({limit, 10, 20, 30, 50, 100}, reverse=True)

        for cache_limit in cache_limits:
            cache_key = history_cache_key(
                chat_id,
                user_id,
                cache_limit,
                before=None,
                version=version,
            )
            cached_history = await RedisDao.get_value(redis, cache_key)
            if not cached_history:
                continue
            try:
                history = MessageHistory.model_validate_json(cached_history)
            except ValueError:
                await RedisDao.delete_key(redis, cache_key)
                continue

            messages = history.messages
            if len(messages) >= limit:
                return messages[:limit]
            if len(messages) < cache_limit:
                # A page shorter than its requested limit contains the full history.
                return messages

        return await MessageDao.get_chat_history(
            session=session,
            chat_id=chat_id,
            user_id=user_id,
            limit=limit,
        )

    @staticmethod
    def format_chat_context(messages: Sequence[ContextMessage]) -> str:
        participant_names: dict[uuid.UUID, str] = {}
        lines: list[str] = []
        remaining_chars = MAX_CONTEXT_CHARS

        for message in reversed(messages):
            participant = participant_names.setdefault(
                message.user_id,
                f"Участник {len(participant_names) + 1}",
            )
            parts = [message.text.strip()] if message.text else []
            for attachment in message.attachments:
                attachment_info = f"[Вложение: {attachment.file_name}]"
                if attachment.text:
                    attachment_info += f" {attachment.text[:1000]}"
                parts.append(attachment_info)
            content = " ".join(parts) or "[Сообщение без текста]"
            line = f"{participant}: {content}"
            if len(line) > remaining_chars:
                line = line[:remaining_chars]
            lines.append(line)
            remaining_chars -= len(line) + 1
            if remaining_chars <= 0:
                break

        return "\n".join(lines)

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
