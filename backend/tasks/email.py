from tasks.config import celery_app
from core.send_email import send_verification_email


@celery_app.task
def send_mail_task(user_email):
    send_verification_email(user_email=user_email)
