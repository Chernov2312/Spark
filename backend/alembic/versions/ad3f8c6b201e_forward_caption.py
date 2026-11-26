"""Store captions attached to forwarded messages."""

from alembic import op
import sqlalchemy as sa

revision = "ad3f8c6b201e"
down_revision = "d94a7f21c6b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("forward_caption", sa.String(1000), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("messages", "forward_caption")
