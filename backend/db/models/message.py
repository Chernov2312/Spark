from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, String
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
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    text: Mapped[str] = mapped_column(String(1000), nullable=True)
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
