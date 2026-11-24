"""Add profile details and field visibility controls."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "d94a7f21c6b3"
down_revision = "f31e08d2b46c"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("bio", sa.String(length=500), nullable=True))
    op.add_column("users", sa.Column("birth_date", sa.Date(), nullable=True))
    op.add_column(
        "users",
        sa.Column(
            "profile_visibility",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text(
                "'{\"avatar\": \"everyone\", \"bio\": \"everyone\", \"birth_date\": \"everyone\"}'::jsonb"
            ),
            nullable=False,
        ),
    )
    op.add_column(
        "users",
        sa.Column(
            "profile_exceptions",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "profile_exceptions")
    op.drop_column("users", "profile_visibility")
    op.drop_column("users", "birth_date")
    op.drop_column("users", "bio")
