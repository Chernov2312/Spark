from collections.abc import AsyncIterator
from hashlib import sha256
from typing import TypedDict
import uuid

from infrastructure.redis.client import execute_redis_pipeline, Redis
from infrastructure.redis.message_queue import (
    enqueue_message,
    history_version_key,
    invalidate_chat_history,
    MESSAGE_QUEUE_PREFIX,
)
from schemas.message import LinkPreview, MessageInternalDTO


def _link_preview_key(chat_id: uuid.UUID, message_id: uuid.UUID, url: str) -> str:
    return (
        f"messages:link-preview:{chat_id}:{message_id}:{sha256(url.encode()).hexdigest()}"
    )


class RedisReactionSyncData(TypedDict):
    id: uuid.UUID
    users: dict[str, str]
    reactions_count: dict[str, int]


class RedisDao:
    @staticmethod
    async def initialize_reaction_cache(
        redis: Redis,
        *,
        message_id: uuid.UUID,
        reactions_count: dict[str, int],
        user_reactions: dict[uuid.UUID, str],
    ) -> None:
        counts_key = f"message:reactions_count:{message_id}"
        users_key = f"message:users:{message_id}"
        if await redis.exists(counts_key, users_key):
            return

        async with redis.pipeline(transaction=True) as pipeline:
            if reactions_count:
                pipeline.hset(counts_key, mapping=reactions_count)
            if user_reactions:
                for user_id, emoji in user_reactions.items():
                    pipeline.set(f"message:user_reaction:{message_id}:{user_id}", emoji)
                pipeline.sadd(users_key, *(str(user_id) for user_id in user_reactions))
            await execute_redis_pipeline(pipeline, operation="initialize_reaction_cache")

    @staticmethod
    async def get_link_preview(
        redis: Redis, chat_id: uuid.UUID, message_id: uuid.UUID, url: str
    ) -> LinkPreview | None:
        value = await redis.get(_link_preview_key(chat_id, message_id, url))
        return LinkPreview.model_validate_json(value) if value else None

    @staticmethod
    async def cache_link_preview(
        redis: Redis, chat_id: uuid.UUID, message_id: uuid.UUID, preview: LinkPreview
    ) -> None:
        async with redis.pipeline(transaction=True) as pipeline:
            pipeline.set(
                _link_preview_key(chat_id, message_id, preview.url),
                preview.model_dump_json(),
                ex=7 * 24 * 60 * 60,
            )
            pipeline.incr(history_version_key(chat_id))
            await execute_redis_pipeline(pipeline, operation="cache_link_preview")

    @staticmethod
    async def set_once(
        redis: Redis,
        key: str,
        value: str,
        *,
        expiration_seconds: int,
    ) -> bool:
        return bool(await redis.set(key, value, ex=expiration_seconds, nx=True))

    @staticmethod
    async def get_value(redis: Redis, key: str) -> str | None:
        return await redis.get(key)

    @staticmethod
    async def delete_key(redis: Redis, key: str) -> None:
        await redis.delete(key)

    @staticmethod
    async def get_history_version(redis: Redis, chat_id: uuid.UUID) -> int:
        return int(await redis.get(history_version_key(chat_id)) or 0)

    @staticmethod
    async def get_stream_entries(
        redis: Redis,
        key: str,
        count: int | None = None,
    ) -> list[tuple[str, dict[str, str]]]:
        if count is None:
            return await redis.xrange(key, min="-", max="+")
        return await redis.xrange(key, min="-", max="+", count=count)

    @staticmethod
    async def iter_message_queue_keys(redis: Redis) -> AsyncIterator[str]:
        async for key in redis.scan_iter(match=f"{MESSAGE_QUEUE_PREFIX}*"):
            yield key

    @staticmethod
    async def delete_stream_entries(
        redis: Redis,
        key: str,
        entry_ids: list[str],
    ) -> None:
        if entry_ids:
            await redis.xdel(key, *entry_ids)

    @staticmethod
    async def cache_history_if_current(
        redis: Redis,
        *,
        chat_id: uuid.UUID,
        expected_version: int,
        key: str,
        value: str,
        expiration_seconds: int,
    ) -> bool:
        current_version = await RedisDao.get_history_version(redis, chat_id)
        if current_version != expected_version:
            return False
        await redis.set(key, value, ex=expiration_seconds)
        return True

    @staticmethod
    async def publish_chat_event(
        redis: Redis,
        chat_id: uuid.UUID,
        payload: str,
    ) -> None:
        await redis.publish(f"chat:{chat_id}", payload)

    @staticmethod
    async def enqueue_message(redis: Redis, message: MessageInternalDTO) -> None:
        await enqueue_message(redis, message)

    @staticmethod
    async def add_chat_user(
        redis: Redis,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        await redis.sadd(f"chat:{chat_id}:users", str(user_id))

    @staticmethod
    async def remove_chat_user(
        redis: Redis,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        await redis.srem(f"chat:{chat_id}:users", str(user_id))

    @staticmethod
    async def get_message_chat_id(redis: Redis, message_id: uuid.UUID) -> str | None:
        return await redis.get(f"message:chat:{message_id}")

    @staticmethod
    async def get_reaction_counts(
        redis: Redis,
        message_id: uuid.UUID,
    ) -> dict[str, str]:
        return await redis.hgetall(f"message:reactions_count:{message_id}")

    @staticmethod
    async def set_reaction(
        redis: Redis,
        *,
        message_id: uuid.UUID,
        user_id: uuid.UUID,
        emoji: str,
    ) -> dict[str, str]:
        user_key = f"message:user_reaction:{message_id}:{user_id}"
        counts_key = f"message:reactions_count:{message_id}"
        users_key = f"message:users:{message_id}"
        current_emoji = await redis.get(user_key)

        async with redis.pipeline(transaction=True) as pipeline:
            if current_emoji is None:
                pipeline.hincrby(counts_key, emoji, 1)
                pipeline.set(user_key, emoji)
                pipeline.sadd(users_key, str(user_id))
            elif current_emoji == emoji:
                pipeline.hincrby(counts_key, current_emoji, -1)
                pipeline.delete(user_key)
                pipeline.srem(users_key, str(user_id))
            else:
                pipeline.hincrby(counts_key, current_emoji, -1)
                pipeline.hincrby(counts_key, emoji, 1)
                pipeline.set(user_key, emoji)
            pipeline.hgetall(counts_key)
            pipeline.sadd("message:reactions:dirty_set", str(message_id))
            results = await execute_redis_pipeline(
                pipeline,
                operation="set_reaction",
            )

        return results[-2]

    @staticmethod
    async def remove_reaction(
        redis: Redis,
        *,
        message_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> tuple[dict[str, str], bool]:
        user_key = f"message:user_reaction:{message_id}:{user_id}"
        counts_key = f"message:reactions_count:{message_id}"
        users_key = f"message:users:{message_id}"
        current_emoji = await redis.get(user_key)
        if current_emoji is None:
            return await redis.hgetall(counts_key), False

        async with redis.pipeline(transaction=True) as pipeline:
            pipeline.delete(user_key)
            pipeline.srem(users_key, str(user_id))
            pipeline.hincrby(counts_key, current_emoji, -1)
            pipeline.hgetall(counts_key)
            pipeline.sadd("message:reactions:dirty_set", str(message_id))
            results = await execute_redis_pipeline(
                pipeline,
                operation="remove_reaction",
            )
        return results[-2], True

    @staticmethod
    async def clear_reaction_cache(
        redis: Redis,
        batch_size: int = 1000,
    ) -> list[RedisReactionSyncData]:
        message_ids = await redis.spop("message:reactions:dirty_set", count=batch_size)
        if not message_ids:
            return []

        async with redis.pipeline(transaction=False) as pipeline:
            for message_id in message_ids:
                pipeline.hgetall(f"message:reactions_count:{message_id}")
                pipeline.smembers(f"message:users:{message_id}")
            responses = await execute_redis_pipeline(
                pipeline,
                operation="load_reaction_sync_data",
            )

        user_emoji_results = []
        user_count = 0
        async with redis.pipeline(transaction=False) as pipeline:
            for index, message_id in enumerate(message_ids):
                users = responses[index * 2 + 1]
                for user_id in users:
                    pipeline.get(f"message:user_reaction:{message_id}:{user_id}")
                    user_count += 1
            if user_count:
                user_emoji_results = await execute_redis_pipeline(
                    pipeline,
                    operation="load_reaction_user_values",
                )

        async with redis.pipeline(transaction=False) as pipeline:
            for index, message_id in enumerate(message_ids):
                users = responses[index * 2 + 1]
                for user_id in users:
                    pipeline.delete(f"message:user_reaction:{message_id}:{user_id}")
                pipeline.delete(f"message:reactions_count:{message_id}")
                pipeline.delete(f"message:users:{message_id}")
            await execute_redis_pipeline(
                pipeline,
                operation="clear_reaction_cache",
            )

        result: list[RedisReactionSyncData] = []
        user_emoji_index = 0
        for index, message_id in enumerate(message_ids):
            reaction_counts = responses[index * 2]
            users = responses[index * 2 + 1]
            clean_counts = {
                emoji: int(count)
                for emoji, count in reaction_counts.items()
                if int(count) > 0
            }
            user_reactions: dict[str, str] = {}
            for user_id in users:
                emoji = user_emoji_results[user_emoji_index]
                user_emoji_index += 1
                if emoji:
                    user_reactions[user_id] = emoji
            result.append(
                {
                    "id": uuid.UUID(str(message_id)),
                    "users": user_reactions,
                    "reactions_count": clean_counts,
                },
            )
        return result

    @staticmethod
    async def invalidate_history(redis: Redis, chat_id: uuid.UUID | str) -> None:
        await invalidate_chat_history(redis, chat_id)

    @staticmethod
    async def invalidate_history_for_message(
        redis: Redis,
        message_id: uuid.UUID,
        chat_id: str | uuid.UUID | None,
    ) -> None:
        if chat_id is not None:
            await invalidate_chat_history(redis, chat_id)
