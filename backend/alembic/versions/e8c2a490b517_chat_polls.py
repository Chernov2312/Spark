"""Add chat polls, options and votes.

Revision ID: e8c2a490b517
Revises: d2b4f8a90316
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "e8c2a490b517"
down_revision = "d2b4f8a90316"
branch_labels = None
depends_on = None


def timestamps() -> list[sa.Column]:
    return [
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
    ]


def upgrade() -> None:
    op.create_table("polls", *timestamps(),
        sa.Column("message_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("creator_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("question", sa.String(300), nullable=False),
        sa.Column("is_anonymous", sa.Boolean(), nullable=False),
        sa.Column("allow_retract", sa.Boolean(), nullable=False),
        sa.Column("is_quiz", sa.Boolean(), nullable=False),
        sa.Column("correct_option_index", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), server_default="1", nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id"),
        sa.CheckConstraint("version > 0", name="ck_poll_version"),
        sa.CheckConstraint("(is_quiz AND correct_option_index IS NOT NULL AND correct_option_index >= 0) OR (NOT is_quiz AND correct_option_index IS NULL)", name="ck_poll_quiz_answer"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["chat_id"], ["chats.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["creator_id"], ["users.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_polls_chat_id", "polls", ["chat_id"])
    op.create_table("poll_options", *timestamps(),
        sa.Column("poll_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("text", sa.String(150), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("poll_id", "position", name="uq_poll_option_position"),
        sa.UniqueConstraint("poll_id", "id", name="uq_poll_option_identity"),
        sa.CheckConstraint("position >= 0 AND position < 10", name="ck_poll_option_position"),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="CASCADE"),
    )
    op.create_index("ix_poll_options_poll_id", "poll_options", ["poll_id"])
    op.create_table("poll_votes", *timestamps(),
        sa.Column("poll_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("option_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("poll_id", "user_id", name="uq_poll_vote_user"),
        sa.ForeignKeyConstraint(["poll_id"], ["polls.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["poll_id", "option_id"], ["poll_options.poll_id", "poll_options.id"], ondelete="CASCADE", name="fk_poll_vote_option"),
    )
    op.create_index("ix_poll_votes_poll_id", "poll_votes", ["poll_id"])
    op.create_index("ix_poll_votes_user_id", "poll_votes", ["user_id"])


def downgrade() -> None:
    op.drop_table("poll_votes")
    op.drop_table("poll_options")
    op.drop_table("polls")
