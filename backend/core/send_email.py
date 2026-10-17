import smtplib
from datetime import timedelta
from email.message import EmailMessage

from config import email
from config.app import settings
from core.security import create_access_token


def send_verification_email(user_email: str):
    msg = EmailMessage()
    msg["Subject"] = "Подтверждение регистрации в Мессенджере"
    msg["From"] = email.FROM_EMAIL
    msg["To"] = user_email

    verification_token_expires = timedelta(days=settings.VERIFICATION_TOKEN_EXPIRE_DAYS)
    verification_token = create_access_token(
        data={"sub": user_email},
        expires_delta=verification_token_expires,
    )

    verification_link = "localhost:8000/" + "api/v1/verification/" + verification_token
    html_content = f"""
    <html>
      <body>
        <h2>Добро пожаловать!</h2>
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
