from tasks.config_celery import celery_app

from core.send_email import send_verification_email


@celery_app.task
def send_mail_task(user_email, user_username, user_id, base_url):
    send_verification_email(
        user_email=user_email,
        user_username=user_username,
        user_id=user_id,
        base_url=base_url,
    )
