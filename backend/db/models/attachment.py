import uuid
from typing import Optional

from sqlalchemy import ForeignKey, Integer, String, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


class Attachment(Base):
    attachment_url: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
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
    is_avatar: Mapped[bool] = mapped_column(Boolean, default=False, server_default=False)
    file_name: Mapped[str] = mapped_column(String(250))
    file_size: Mapped[int] = mapped_column(Integer)
    mime_type: Mapped[str] = mapped_column(String(70), nullable=False)
