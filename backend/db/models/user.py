from sqlalchemy import Column, ForeignKey, String, Table, Boolean
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base

user_chat = Table(
    "user_chat",
    Base.metadata,
    Column(
        "user_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "chat_id",
        UUID(as_uuid=True),
        ForeignKey("chats.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    keep_existing=True,
)


class User(Base):
    username: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        unique=True,
    )
    password: Mapped[str] = mapped_column(String(250), nullable=False)
    email: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
    )
    chats: Mapped[list["Chat"]] = relationship(
        "Chat",
        back_populates="users",
        secondary=user_chat,
    )
    created_chats: Mapped[list["Chat"]] = relationship(
        "Chat",
        back_populates="owner",
        cascade="all, delete-orphan",
    )
    avatars: Mapped[list["Attachment"]] = relationship(
        "Attachment",
        back_populates="user",
    )
    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
    )
