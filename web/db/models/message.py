import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


class Message(Base):
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id"),
        nullable=False,
    )
    user: Mapped["User"] = relationship("User")
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id"),
        nullable=False,
    )
    chat: Mapped["Chat"] = relationship("Chat")
    text: Mapped[str] = mapped_column(String(1000), nullable=False)
    reactions_count: Mapped[dict] = mapped_column(
        JSONB,
        server_default="{}",
        nullable=False,
    )
