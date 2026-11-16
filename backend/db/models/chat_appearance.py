import uuid

from sqlalchemy import ForeignKeyConstraint, String, UniqueConstraint, UUID
from sqlalchemy.orm import Mapped, mapped_column

from db.database import Base


class ChatAppearance(Base):
    __tablename__ = "chat_appearances"
    __table_args__ = (
        UniqueConstraint("user_id", "chat_id", name="uq_chat_appearance_user_chat"),
        ForeignKeyConstraint(
            ["user_id", "chat_id"],
            ["user_chat.user_id", "user_chat.chat_id"],
            ondelete="CASCADE",
            name="fk_chat_appearance_membership",
        ),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    chat_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    avatar_file_key: Mapped[str] = mapped_column(String(512), nullable=False)
