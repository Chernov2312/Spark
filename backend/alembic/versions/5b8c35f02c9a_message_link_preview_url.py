"""Store the link URL selected by the message client.

Revision ID: 5b8c35f02c9a
Revises: e8c2a490b517
"""

from alembic import op
import sqlalchemy as sa

revision = "5b8c35f02c9a"
down_revision = "e8c2a490b517"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("link_preview_url", sa.String(2048), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "link_preview_url")
