import asyncio

from core.send_email import send_password_reset_email, send_verification_email
from tasks.config_celery import celery_app


@celery_app.task
def send_mail_task(
    user_email: str,
    user_username: str,
    user_id: str,
    base_url: str,
) -> None:
    asyncio.run(
        send_verification_email(
            user_email=user_email,
            user_username=user_username,
            user_id=user_id,
            base_url=base_url,
        ),
    )


@celery_app.task
def send_password_reset_mail_task(
    user_email: str,
    user_username: str,
    user_id: str,
    base_url: str,
) -> None:
    asyncio.run(
        send_password_reset_email(
            user_email=user_email,
            user_username=user_username,
            user_id=user_id,
            base_url=base_url,
        ),
    )
