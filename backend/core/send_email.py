import secrets
import smtplib
from config.app import settings
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from core.security import (
    authenticate_user,
    create_access_token,
    get_password_hash,
)
from db.database import get_session

from db.dao.user_dao import UserDao
from email.message import EmailMessage
import stmplib


async def send_verification_email(user_email: str, session: AsyncSession):
    msg = EmailMessage()
    msg["Subject"] = "Подтверждение регистрации в Мессенджере"
    msg["From"] = "testaccvova@gmail.com"
    msg["To"] = user_email

    verification_token_expires = timedelta(days=settings.VERIFICATION_TOKEN_EXPIRE_DAYS)
    verification_token = create_access_token(
        data={"sub": user_email},
    )

    verification_link = "local"

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
            server.login("testaccvova@gmail.com", "qzgr lhhl jfsc csfz")
            server.send_message(msg)
        print("Message was successfully sended")
    except Exception as e:
        print(f"Error: {e}")


send_verification_email("bulychev.v.m@gmail.com")
