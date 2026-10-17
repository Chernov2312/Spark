import uuid

from sqlalchemy import ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base


class MessageReaction(Base):
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    emoji: Mapped[str] = mapped_column(String(10), nullable=False)

    __table_args__ = (
        Index("ix_message_reactions_user_id_message_id", "user_id", "message_id"),
        UniqueConstraint(
            "user_id",
            "message_id",
            "emoji",
            name="uq_user_message_emoji",
        ),
    )
