from datetime import datetime
import uuid

from sqlalchemy import DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base


class MessagePin(Base):
    __tablename__ = "message_pins"
    __table_args__ = (
        UniqueConstraint("chat_id", "message_id", name="uq_chat_message_pin"),
    )

    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), nullable=False
    )
    pinned_by: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )


class ChatReadState(Base):
    __tablename__ = "chat_read_states"
    __table_args__ = (UniqueConstraint("chat_id", "user_id", name="uq_chat_read_user"),)

    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    last_read_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True
    )
    last_read_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
