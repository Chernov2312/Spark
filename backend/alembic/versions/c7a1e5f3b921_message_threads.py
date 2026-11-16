"""Add message threads.

Revision ID: c7a1e5f3b921
Revises: 42de1a9c7f30
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "c7a1e5f3b921"
down_revision = "42de1a9c7f30"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("thread_root_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_foreign_key(
        "fk_messages_thread_root_id_messages",
        "messages",
        "messages",
        ["thread_root_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_messages_thread_root_id_created_at",
        "messages",
        ["thread_root_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_messages_thread_root_id_created_at", table_name="messages")
    op.drop_constraint(
        "fk_messages_thread_root_id_messages",
        "messages",
        type_="foreignkey",
    )
    op.drop_column("messages", "thread_root_id")
