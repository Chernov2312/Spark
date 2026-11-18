import uuid

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base


class Poll(Base):
    __tablename__ = "polls"
    __table_args__ = (
        CheckConstraint("version > 0", name="ck_poll_version"),
        CheckConstraint(
            "(is_quiz AND correct_option_index IS NOT NULL AND correct_option_index >= 0) OR (NOT is_quiz AND correct_option_index IS NULL)",
            name="ck_poll_quiz_answer",
        ),
    )

    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), unique=True
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("chats.id", ondelete="CASCADE"), index=True
    )
    creator_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE")
    )
    question: Mapped[str] = mapped_column(String(300))
    is_anonymous: Mapped[bool] = mapped_column(Boolean, default=True)
    allow_retract: Mapped[bool] = mapped_column(Boolean, default=True)
    is_quiz: Mapped[bool] = mapped_column(Boolean, default=False)
    correct_option_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    version: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    options: Mapped[list["PollOption"]] = relationship(
        cascade="all, delete-orphan", order_by="PollOption.position"
    )
    votes: Mapped[list["PollVote"]] = relationship(
        cascade="all, delete-orphan", foreign_keys="PollVote.poll_id"
    )


class PollOption(Base):
    __tablename__ = "poll_options"
    __table_args__ = (
        UniqueConstraint("poll_id", "position", name="uq_poll_option_position"),
        UniqueConstraint("poll_id", "id", name="uq_poll_option_identity"),
        CheckConstraint(
            "position >= 0 AND position < 10", name="ck_poll_option_position"
        ),
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("polls.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(String(150))
    position: Mapped[int] = mapped_column(Integer)


class PollVote(Base):
    __tablename__ = "poll_votes"
    __table_args__ = (
        UniqueConstraint("poll_id", "user_id", name="uq_poll_vote_user"),
        ForeignKeyConstraint(
            ["poll_id", "option_id"],
            ["poll_options.poll_id", "poll_options.id"],
            ondelete="CASCADE",
            name="fk_poll_vote_option",
        ),
    )
    poll_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("polls.id", ondelete="CASCADE"), index=True
    )
    option_id: Mapped[uuid.UUID] = mapped_column()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    user: Mapped["User"] = relationship()
