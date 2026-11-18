import asyncio
from datetime import timedelta
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from html import escape
import smtplib
import ssl
from urllib.parse import quote
import uuid

from config import get_email_settings, get_settings
from core.security import create_access_token


def _deliver_email(message: EmailMessage) -> None:
    email = get_email_settings()
    message["Date"] = formatdate(localtime=False, usegmt=True)
    message["Message-ID"] = make_msgid()
    with smtplib.SMTP_SSL(
        email.SMTP_HOST,
        email.SMTP_PORT,
        timeout=30,
        context=ssl.create_default_context(),
    ) as server:
        server.login(email.LOGIN_EMAIL, email.PASSWORD_EMAIL.get_secret_value())
        server.send_message(message)


async def send_verification_email(
    user_email: str,
    user_username: str,
    user_id: str,
    base_url: str,
) -> None:
    settings = get_settings()
    email = get_email_settings()
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

    await asyncio.to_thread(_deliver_email, msg)


async def send_password_reset_email(
    user_email: str,
    user_username: str,
    user_id: str,
    base_url: str,
) -> None:
    settings = get_settings()
    email = get_email_settings()
    reset_token = create_access_token(
        data={
            "sub": user_email,
            "user_id": user_id,
            "purpose": "password_reset",
            "jti": str(uuid.uuid4()),
        },
        expires_delta=timedelta(
            minutes=settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES,
        ),
    )
    reset_link = f"{base_url.rstrip('/')}/reset-password/{quote(reset_token, safe='')}"
    safe_username = escape(user_username)
    safe_link = escape(reset_link, quote=True)

    msg = EmailMessage()
    msg["Subject"] = "Сброс пароля Spark"
    msg["From"] = email.FROM_EMAIL
    msg["To"] = user_email
    msg.set_content(
        f"Здравствуйте, {user_username}!\n\n"
        "Чтобы задать новый пароль Spark, откройте ссылку:\n"
        f"{reset_link}\n\n"
        f"Ссылка действует {settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES} минут. "
        "Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо."
    )
    msg.add_alternative(
        f"""
        <html><body>
          <h2>Сброс пароля Spark</h2>
          <p>Здравствуйте, {safe_username}!</p>
          <p>Чтобы задать новый пароль, нажмите на ссылку:</p>
          <p><a href="{safe_link}">Создать новый пароль</a></p>
          <p>Ссылка действует {settings.PASSWORD_RESET_TOKEN_EXPIRE_MINUTES} минут.</p>
          <p>Если вы не запрашивали сброс пароля, проигнорируйте это письмо.</p>
        </body></html>
        """,
        subtype="html",
    )

    await asyncio.to_thread(_deliver_email, msg)
