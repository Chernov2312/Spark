import uuid

from sqlalchemy import ForeignKey, Index, String
from sqlalchemy import text as sa_text
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
    attachments: Mapped[list["Attachment"]] = relationship("Attachment")
    reactions_count: Mapped[dict] = mapped_column(
        JSONB,
        server_default="{}",
        nullable=False,
    )
    __table_args__ = (
        Index(
            "ix_messages_chat_id_created_at_desc",
            "chat_id",
            sa_text("created_at DESC"),
        ),
    )
