import uuid
from typing import Optional

from sqlalchemy import ForeignKey, String
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

    mime_type: Mapped[str] = mapped_column(String(70), nullable=False)
