import smtplib
from datetime import timedelta
from email.message import EmailMessage

from config import email
from config.app import settings
from core.security import create_access_token


def send_verification_email(
    user_email: str,
    user_username: str,
    user_id: str,
    base_url: str,
):
    msg = EmailMessage()
    msg["Subject"] = "Подтверждение регистрации в Мессенджере"
    msg["From"] = email.FROM_EMAIL
    msg["To"] = user_email

    verification_token_expires = timedelta(days=settings.VERIFICATION_TOKEN_EXPIRE_DAYS)
    verification_token = create_access_token(
        data={"sub": user_email, "username": user_username, "user_id": user_id},
        expires_delta=verification_token_expires,
    )

    verification_link = f"{base_url}/auth/verification/{verification_token}"
    html_content = f"""
    <html>
      <body>
        <h2>Добро пожаловать {user_username}!</h2>
        <p>Для подтверждения почты перейдите по ссылке:</p>
        <a href="{verification_link}">Подтвердить email</a>
        <p>Или скопируйте её: {verification_link}</p>
        <p>Ссылка действительна 24 часа.</p>
      </body>
    </html>
    """

    msg.set_content(html_content, subtype="html")

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(email.LOGIN_EMAIL, email.PASSWORD_EMAIL)
            server.send_message(msg)
        print("Message was successfully sended")
    except Exception as e:
        print(f"Error: {e}")
