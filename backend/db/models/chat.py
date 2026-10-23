import uuid

from sqlalchemy import ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from db.database import Base
from db.models.user import user_chat


class Chat(Base):
    users: Mapped[list["User"]] = relationship(
        "User",
        back_populates="chats",
        secondary=user_chat,
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    owner: Mapped["User"] = relationship(
        "User",
        back_populates="created_chats",
    )
    title: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        unique=True,
    )
    description: Mapped[str] = mapped_column(
        String(500),
        unique=False,
    )
    avatars: Mapped[list["Attachment"]] = relationship(
        "Attachment",
        back_populates="chat",
        primaryjoin=(
            "Chat.id == foreign(Attachment.chat_id) and Attachment.is_avatar == True"
        ),
    )
