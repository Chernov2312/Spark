import uuid

from sqlalchemy import (
    CheckConstraint,
    Column,
    false,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    String,
    Table,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base
from db.models.user import user_chat


class Friendship(Base):
    """A single relationship for an unordered pair of users."""

    user_low_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_high_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    requested_by_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")

    __table_args__ = (
        UniqueConstraint("user_low_id", "user_high_id", name="uq_friendship_user_pair"),
        CheckConstraint("user_low_id < user_high_id", name="ck_friendship_sorted_users"),
        CheckConstraint(
            "requested_by_id = user_low_id OR requested_by_id = user_high_id",
            name="ck_friendship_requester_is_member",
        ),
        CheckConstraint(
            "status IN ('pending', 'accepted', 'declined')",
            name="ck_friendship_status",
        ),
        Index("ix_friendships_low_status", "user_low_id", "status"),
        Index("ix_friendships_high_status", "user_high_id", "status"),
    )


class FriendCategory(Base):
    __tablename__ = "friend_categories"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    is_default: Mapped[bool] = mapped_column(
        default=False,
        server_default=false(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_friend_category_owner_name"),
        UniqueConstraint("id", "owner_id", name="uq_friend_category_id_owner"),
    )


friendship_categories = Table(
    "friendship_categories",
    Base.metadata,
    Column(
        "friendship_id",
        UUID(as_uuid=True),
        ForeignKey("friendships.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "owner_id",
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column("category_id", UUID(as_uuid=True), nullable=False),
    Index("ix_friendship_categories_owner", "owner_id"),
    ForeignKeyConstraint(
        ["category_id", "owner_id"],
        ["friend_categories.id", "friend_categories.owner_id"],
        ondelete="CASCADE",
        name="fk_friendship_category_owned_by_user",
    ),
    keep_existing=True,
)


class ChatFolder(Base):
    __tablename__ = "chat_folders"

    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(String(40), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)
    is_default: Mapped[bool] = mapped_column(
        default=False,
        server_default=false(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("owner_id", "name", name="uq_chat_folder_owner_name"),
        UniqueConstraint("id", "owner_id", name="uq_chat_folder_id_owner"),
    )


chat_folder_chats = Table(
    "chat_folder_chats",
    Base.metadata,
    Column("folder_id", UUID(as_uuid=True), primary_key=True),
    Column("chat_id", UUID(as_uuid=True), primary_key=True),
    Column("owner_id", UUID(as_uuid=True), nullable=False),
    Index("ix_chat_folder_chats_owner", "owner_id"),
    ForeignKeyConstraint(
        ["folder_id", "owner_id"],
        ["chat_folders.id", "chat_folders.owner_id"],
        ondelete="CASCADE",
        name="fk_chat_folder_chat_folder_owner",
    ),
    ForeignKeyConstraint(
        ["owner_id", "chat_id"],
        [user_chat.c.user_id, user_chat.c.chat_id],
        ondelete="CASCADE",
        name="fk_chat_folder_chat_membership",
    ),
    keep_existing=True,
)
