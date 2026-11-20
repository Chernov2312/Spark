import asyncio
import json
import logging
from typing import Any
import uuid

from kombu.exceptions import KombuError
from pywebpush import webpush, WebPushException
import requests

from config import get_settings
from db.dao.push_subscription_dao import PushSubscriptionDao
from db.database import async_session_maker
from db.models import PushSubscription
from schemas.push import validate_push_endpoint
from tasks.config_celery import celery_app, run_async_task

logger = logging.getLogger(__name__)


class PushServiceSession(requests.Session):
    def post(self, url: str, **kwargs: Any) -> requests.Response:
        return super().post(url, allow_redirects=False, **kwargs)


def send_to_browser(
    subscription: PushSubscription,
    chat_id: uuid.UUID,
    message_id: uuid.UUID,
    silent: bool,
) -> bool:
    """Return whether the push provider has invalidated the subscription."""
    settings = get_settings()
    try:
        endpoint = validate_push_endpoint(subscription.endpoint)
        with PushServiceSession() as client:
            client.trust_env = False
            webpush(
                subscription_info={
                    "endpoint": endpoint,
                    "keys": {
                        "p256dh": subscription.p256dh,
                        "auth": subscription.auth_secret,
                    },
                },
                data=json.dumps(
                    {
                        "chat_id": str(chat_id),
                        "message_id": str(message_id),
                        "silent": silent,
                    }
                ),
                vapid_private_key=settings.WEB_PUSH_PRIVATE_KEY.get_secret_value(),
                vapid_claims={"sub": settings.WEB_PUSH_SUBJECT},
                requests_session=client,
                ttl=3600,
                timeout=5,
            )
    except WebPushException as error:
        if error.response is not None and error.response.status_code in (404, 410):
            return True
        logger.warning("Push delivery failed for subscription %s", subscription.id)
    except (ValueError, requests.RequestException):
        logger.warning("Push delivery failed for subscription %s", subscription.id)
    return False


async def deliver_message_push(
    chat_id: uuid.UUID, sender_id: uuid.UUID, message_id: uuid.UUID
) -> None:
    if not get_settings().web_push_enabled:
        return
    async with async_session_maker() as session:
        subscriptions = await PushSubscriptionDao.list_for_chat(
            session, chat_id, sender_id
        )
    concurrency = asyncio.Semaphore(8)

    async def deliver(subscription: PushSubscription) -> None:
        options = subscription.chat_options.get(str(chat_id), {})
        if options.get("muted"):
            return
        async with concurrency:
            expired = await asyncio.to_thread(
                send_to_browser,
                subscription,
                chat_id,
                message_id,
                options.get("silent", False),
            )
        if expired:
            async with async_session_maker.begin() as session:
                await PushSubscriptionDao.remove_expired(session, subscription)

    await asyncio.gather(*(deliver(subscription) for subscription in subscriptions))


@celery_app.task(ignore_result=True)
def push_message_task(chat_id: str, sender_id: str, message_id: str) -> None:
    asyncio.run(
        run_async_task(
            deliver_message_push(
                uuid.UUID(chat_id), uuid.UUID(sender_id), uuid.UUID(message_id)
            )
        )
    )


async def enqueue_message_push(
    chat_id: uuid.UUID, sender_id: uuid.UUID, message_id: uuid.UUID
) -> None:
    if not get_settings().web_push_enabled:
        return
    try:
        await asyncio.to_thread(
            push_message_task.apply_async,
            args=(str(chat_id), str(sender_id), str(message_id)),
            retry=False,
        )
    except (KombuError, OSError):
        logger.warning("Could not queue notification for message %s", message_id)
