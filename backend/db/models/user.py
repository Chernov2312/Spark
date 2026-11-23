from datetime import date

from sqlalchemy import Boolean, Column, Date, false, ForeignKey, String, Table, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.user_tags import normalize_user_tag
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
    Column("role", String(16), nullable=False, server_default=text("'member'")),
    keep_existing=True,
)


class User(Base):
    username: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        unique=False,
    )
    tag: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        unique=True,
        index=True,
        default=lambda context: normalize_user_tag(
            context.get_current_parameters().get("username", "user"),
        ),
    )
    password: Mapped[str] = mapped_column(String(250), nullable=False)
    email: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
    )
    bio: Mapped[str | None] = mapped_column(String(500), nullable=True)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    profile_visibility: Mapped[dict[str, str]] = mapped_column(
        JSONB,
        nullable=False,
        default=lambda: {
            "avatar": "everyone",
            "bio": "everyone",
            "birth_date": "everyone",
        },
        server_default=text(
            "'{\"avatar\": \"everyone\", \"bio\": \"everyone\", "
            "\"birth_date\": \"everyone\"}'::jsonb"
        ),
    )
    profile_exceptions: Mapped[dict[str, list[str]]] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
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
        primaryjoin=(
            "User.id == foreign(Attachment.user_id) and Attachment.is_avatar == True"
        ),
    )
    is_verified: Mapped[bool] = mapped_column(
        Boolean,
        default=False,
        server_default=false(),
    )
