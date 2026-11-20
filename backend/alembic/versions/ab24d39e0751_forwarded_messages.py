"""Mark messages created by forwarding."""

from alembic import op
import sqlalchemy as sa

revision = "ab24d39e0751"
down_revision = "3e61f7b2a8cd"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("is_forwarded", sa.Boolean(), server_default=sa.false(), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("messages", "is_forwarded")
