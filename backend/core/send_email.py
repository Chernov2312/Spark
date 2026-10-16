import secrets
import smtplib
from email.message import EmailMessage
import stmplib


def send_verification_email(user_email: str):
    msg = EmailMessage()
    msg["Subject"] = "Подтверждение регистрации в Мессенджере"
    msg["From"] = "testaccvova@gmail.com"
    msg["To"] = user_email

    verification_link = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

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
