from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, Index, select, String
from sqlalchemy import text as sa_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import (
    column_property,
    declared_attr,
    Mapped,
    mapped_column,
    relationship,
)

from db.database import Base
from db.models.poll import Poll


class Message(Base):
    @declared_attr
    def poll_id(cls) -> Mapped[uuid.UUID | None]:
        return column_property(
            select(Poll.id)
            .where(Poll.message_id == cls.id)
            .correlate_except(Poll)
            .scalar_subquery(),
        )

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
    thread_root_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=True,
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    text: Mapped[str] = mapped_column(String(1000), nullable=True)
    attachments: Mapped[list["Attachment"]] = relationship("Attachment")
    reactions_count: Mapped[dict[str, int]] = mapped_column(
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
        Index("ix_messages_thread_root_id_created_at", "thread_root_id", "created_at"),
    )
