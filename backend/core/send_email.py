from datetime import timedelta
from email.message import EmailMessage
from html import escape
import smtplib
from urllib.parse import quote

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

    verification_link = (
        f"{base_url.rstrip('/')}/verify-email/{quote(verification_token, safe='')}"
    )
    safe_username = escape(user_username)
    safe_link = escape(verification_link, quote=True)
    msg.set_content(
        f"\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435, {user_username}!\n\n"
        "\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u043f\u043e\u0447\u0442\u0443 \u043f\u043e \u0441\u0441\u044b\u043b\u043a\u0435:\n"
        f"{verification_link}\n\n"
        "\u0421\u0441\u044b\u043b\u043a\u0430 \u0434\u0435\u0439\u0441\u0442\u0432\u0443\u0435\u0442 24 \u0447\u0430\u0441\u0430. "
        "\u0415\u0441\u043b\u0438 \u0432\u044b \u043d\u0435 \u0441\u043e\u0437\u0434\u0430\u0432\u0430\u043b\u0438 \u0430\u043a\u043a\u0430\u0443\u043d\u0442 Spark, "
        "\u043f\u0440\u043e\u0441\u0442\u043e \u0438\u0433\u043d\u043e\u0440\u0438\u0440\u0443\u0439\u0442\u0435 \u044d\u0442\u043e \u043f\u0438\u0441\u044c\u043c\u043e."
    )
    html_content = f"""
    <html>
      <body>
        <h2>Добро пожаловать {safe_username}!</h2>
        <p>Для подтверждения почты перейдите по ссылке:</p>
        <a href="{safe_link}">Подтвердить email</a>
        <p>Или скопируйте её: {safe_link}</p>
        <p>Ссылка действительна 24 часа.</p>
      </body>
    </html>
    """

    msg.add_alternative(html_content, subtype="html")

    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as server:
            server.login(email.LOGIN_EMAIL, email.PASSWORD_EMAIL)
            server.send_message(msg)
        print("Message was successfully sended")
    except Exception as e:
        print(f"Error: {e}")
