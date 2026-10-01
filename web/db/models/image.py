import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


class Image(Base):
    image_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=True,
    )
    user: Mapped["User" | None] = relationship(
        "User",
        back_populates="avatars",
    )
    chat_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"),
        nullable=True,
    )
    chat: Mapped["Chat" | None] = relationship(
        "Chat",
        back_populates="avatars",
    )
