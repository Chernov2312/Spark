from datetime import datetime, timezone
import uuid

from infrastructure.redis.message_queue import (
    history_cache_key,
    history_version_key,
    message_queue_key,
)
from infrastructure.redis.redis_dao import RedisDao
from schemas.message import MessageInternalDTO


async def test_redis_dao_cache_queue_presence_and_reactions(
    test_redis_client,
):
    redis = test_redis_client
    chat_id = uuid.uuid4()
    user_id = uuid.uuid4()
    message_id = uuid.uuid4()

    assert (
        await RedisDao.set_once(
            redis,
            "test:set-once",
            "value",
            expiration_seconds=30,
        )
        is True
    )
    assert (
        await RedisDao.set_once(
            redis,
            "test:set-once",
            "other",
            expiration_seconds=30,
        )
        is False
    )
    assert await RedisDao.get_value(redis, "test:set-once") == "value"
    await RedisDao.delete_key(redis, "test:set-once")
    assert await RedisDao.get_value(redis, "test:set-once") is None

    assert await RedisDao.get_history_version(redis, chat_id) == 0
    cache_key = history_cache_key(chat_id, user_id, 20, None, 0)
    assert (
        await RedisDao.cache_history_if_current(
            redis,
            chat_id=chat_id,
            expected_version=0,
            key=cache_key,
            value="cached",
            expiration_seconds=30,
        )
        is True
    )
    assert await RedisDao.get_value(redis, cache_key) == "cached"
    await RedisDao.invalidate_history(redis, chat_id)
    assert await RedisDao.get_history_version(redis, chat_id) == 1
    assert (
        await RedisDao.cache_history_if_current(
            redis,
            chat_id=chat_id,
            expected_version=0,
            key=cache_key,
            value="stale",
            expiration_seconds=30,
        )
        is False
    )

    await RedisDao.add_chat_user(redis, chat_id, user_id)
    assert await redis.smembers(f"chat:{chat_id}:users") == {str(user_id)}
    await RedisDao.remove_chat_user(redis, chat_id, user_id)
    assert await redis.smembers(f"chat:{chat_id}:users") == set()

    message = MessageInternalDTO(
        id=message_id,
        chat_id=chat_id,
        user_id=user_id,
        text="queued",
        created_at=datetime.now(timezone.utc),
    )
    await RedisDao.enqueue_message(redis, message)
    entries = await RedisDao.get_stream_entries(redis, message_queue_key(chat_id))
    assert len(entries) == 1
    assert await RedisDao.get_message_chat_id(redis, message_id) == str(chat_id)
    assert message_queue_key(chat_id) in [
        key async for key in RedisDao.iter_message_queue_keys(redis)
    ]
    assert (
        len(
            await RedisDao.get_stream_entries(
                redis,
                message_queue_key(chat_id),
                count=1,
            ),
        )
        == 1
    )
    await RedisDao.delete_stream_entries(
        redis,
        message_queue_key(chat_id),
        [entry_id for entry_id, _ in entries],
    )
    assert await RedisDao.get_stream_entries(redis, message_queue_key(chat_id)) == []
    assert await RedisDao.get_history_version(redis, chat_id) == 2

    await RedisDao.publish_chat_event(redis, chat_id, "test-event")
    assert history_version_key(chat_id) == f"messages:history-version:{chat_id}"

    assert await RedisDao.set_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
        emoji="🔥",
    ) == {"🔥": "1"}
    assert await RedisDao.get_reaction_counts(redis, message_id) == {"🔥": "1"}
    assert await RedisDao.set_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
        emoji="🔥",
    ) == {"🔥": "0"}
    counts, removed = await RedisDao.remove_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
    )
    assert counts == {"🔥": "0"}
    assert removed is False
    assert await RedisDao.set_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
        emoji="❤️",
    ) == {"🔥": "0", "❤️": "1"}
    counts, removed = await RedisDao.remove_reaction(
        redis,
        message_id=message_id,
        user_id=user_id,
    )
    assert counts == {"🔥": "0", "❤️": "0"}
    assert removed is True

    await RedisDao.invalidate_history_for_message(redis, message_id, chat_id)
    assert await RedisDao.get_history_version(redis, chat_id) == 3
    await RedisDao.invalidate_history_for_message(redis, message_id, None)
    assert await RedisDao.get_history_version(redis, chat_id) == 3
