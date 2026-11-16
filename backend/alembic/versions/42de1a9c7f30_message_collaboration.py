"""Add collaboration fields and per-chat state.

Revision ID: 42de1a9c7f30
Revises: b481c6d927e3
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "42de1a9c7f30"
down_revision = "b481c6d927e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "user_chat",
        sa.Column("role", sa.String(16), server_default="member", nullable=False),
    )
    op.execute(
        "UPDATE user_chat SET role = 'owner' FROM chats "
        "WHERE user_chat.chat_id = chats.id AND user_chat.user_id = chats.owner_id",
    )
    op.add_column(
        "messages",
        sa.Column("reply_to_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.add_column("messages", sa.Column("edited_at", sa.DateTime(), nullable=True))
    op.create_foreign_key(
        "fk_messages_reply_to_id_messages",
        "messages",
        "messages",
        ["reply_to_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "message_pins",
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("pinned_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["pinned_by"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "message_id", name="uq_chat_message_pin"),
    )
    op.create_table(
        "chat_read_states",
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("last_read_message_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("last_read_at", sa.DateTime(), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["last_read_message_id"], ["messages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("chat_id", "user_id", name="uq_chat_read_user"),
    )


def downgrade() -> None:
    op.drop_table("chat_read_states")
    op.drop_table("message_pins")
    op.drop_constraint("fk_messages_reply_to_id_messages", "messages", type_="foreignkey")
    op.drop_column("messages", "edited_at")
    op.drop_column("messages", "reply_to_id")
    op.drop_column("user_chat", "role")
