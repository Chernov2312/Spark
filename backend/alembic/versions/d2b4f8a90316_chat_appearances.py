"""Add personal chat avatars per membership."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d2b4f8a90316"
down_revision = "c7a1e5f3b921"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "chat_appearances",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("avatar_file_key", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "chat_id", name="uq_chat_appearance_user_chat"),
        sa.ForeignKeyConstraint(
            ["user_id", "chat_id"], ["user_chat.user_id", "user_chat.chat_id"],
            ondelete="CASCADE", name="fk_chat_appearance_membership",
        ),
    )


def downgrade() -> None:
    op.drop_table("chat_appearances")
