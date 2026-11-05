import uuid
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


class Attachment(Base):
    file_key: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    user_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    user: Mapped[Optional["User"]] = relationship(
        "User",
        back_populates="avatars",
    )
    chat_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=True,
    )
    chat: Mapped[Optional["Chat"]] = relationship(
        "Chat",
        back_populates="avatars",
    )
    msg_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    message: Mapped["Message"] = relationship("Message", back_populates="attachments")
    is_avatar: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default="false",
    )
    file_name: Mapped[str] = mapped_column(String(250))
    file_size: Mapped[int] = mapped_column(Integer)
    mime_type: Mapped[str] = mapped_column(String(70), nullable=False)
