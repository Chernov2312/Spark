from email.message import EmailMessage
import smtplib
from unittest.mock import AsyncMock, MagicMock

from celery.app.task import Task
import pytest
from tasks.email import send_mail_task, send_password_reset_mail_task

from core import send_email


async def test_verification_propagates_delivery_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fail_delivery(message: EmailMessage) -> None:
        raise TimeoutError("SMTP handshake timed out")

    monkeypatch.setattr(send_email, "_deliver_email", fail_delivery)
    with pytest.raises(TimeoutError, match="handshake"):
        await send_email.send_verification_email(
            "recipient@example.com", "User", "user-id", "http://localhost:5174"
        )


@pytest.mark.parametrize("task", [send_mail_task, send_password_reset_mail_task])
def test_mail_task_retries_transient_failure(
    monkeypatch: pytest.MonkeyPatch, task: Task
) -> None:
    send = AsyncMock(side_effect=[TimeoutError("SMTP unavailable"), None])
    function = (
        "send_verification_email"
        if task is send_mail_task
        else "send_password_reset_email"
    )
    monkeypatch.setattr(f"tasks.email.{function}", send)
    result = task.apply(args=("recipient@example.com", "User", "id", "http://localhost"))
    assert result.successful()
    assert send.await_count == 2


def test_smtp_sets_delivery_headers(monkeypatch: pytest.MonkeyPatch) -> None:
    smtp = MagicMock()
    monkeypatch.setattr(send_email.smtplib, "SMTP_SSL", smtp)
    message = EmailMessage()
    message["From"] = "sender@example.com"
    message["To"] = "recipient@example.com"
    message.set_content("Confirmation link")
    send_email._deliver_email(message)
    assert message["Date"]
    assert message["Message-ID"]
    assert smtp.call_args.kwargs["context"].check_hostname
    smtp.return_value.__enter__.return_value.send_message.assert_called_once_with(message)


def test_mail_task_reports_exhausted_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    send = AsyncMock(side_effect=smtplib.SMTPServerDisconnected("SMTP unavailable"))
    monkeypatch.setattr("tasks.email.send_verification_email", send)
    result = send_mail_task.apply(
        args=("recipient@example.com", "User", "id", "http://localhost"), throw=False
    )
    assert result.failed()
    assert send.await_count == 6
