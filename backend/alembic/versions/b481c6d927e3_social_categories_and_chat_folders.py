"""Add friendships, friend categories, and personal chat folders.

Revision ID: b481c6d927e3
Revises: 6d4a2b1c9f80
"""
import uuid

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b481c6d927e3"
down_revision = "6d4a2b1c9f80"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "friendships",
        sa.Column("user_low_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_high_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("requested_by_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint(
            "user_low_id < user_high_id",
            name="ck_friendship_sorted_users",
        ),
        sa.CheckConstraint(
            "requested_by_id = user_low_id OR requested_by_id = user_high_id",
            name="ck_friendship_requester_is_member",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'accepted', 'declined')",
            name="ck_friendship_status",
        ),
        sa.ForeignKeyConstraint(["user_low_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_high_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_low_id", "user_high_id", name="uq_friendship_user_pair"),
    )
    op.create_index("ix_friendships_low_status", "friendships", ["user_low_id", "status"])
    op.create_index("ix_friendships_high_status", "friendships", ["user_high_id", "status"])

    for table_name in ("friend_categories", "chat_folders"):
        op.create_table(
            table_name,
            sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("name", sa.String(length=40), nullable=False),
            sa.Column("color", sa.String(length=7), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "owner_id",
                "name",
                name=(
                    "uq_friend_category_owner_name"
                    if table_name == "friend_categories"
                    else "uq_chat_folder_owner_name"
                ),
            ),
            sa.UniqueConstraint(
                "id",
                "owner_id",
                name=(
                    "uq_friend_category_id_owner"
                    if table_name == "friend_categories"
                    else "uq_chat_folder_id_owner"
                ),
            ),
        )

    op.create_table(
        "friendship_categories",
        sa.Column("friendship_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("category_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(["friendship_id"], ["friendships.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["category_id", "owner_id"],
            ["friend_categories.id", "friend_categories.owner_id"],
            ondelete="CASCADE",
            name="fk_friendship_category_owned_by_user",
        ),
        sa.PrimaryKeyConstraint("friendship_id", "owner_id"),
    )
    op.create_index(
        "ix_friendship_categories_owner",
        "friendship_categories",
        ["owner_id"],
    )

    op.create_table(
        "chat_folder_chats",
        sa.Column("folder_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("chat_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["folder_id", "owner_id"],
            ["chat_folders.id", "chat_folders.owner_id"],
            ondelete="CASCADE",
            name="fk_chat_folder_chat_folder_owner",
        ),
        sa.ForeignKeyConstraint(
            ["owner_id", "chat_id"],
            ["user_chat.user_id", "user_chat.chat_id"],
            ondelete="CASCADE",
            name="fk_chat_folder_chat_membership",
        ),
        sa.PrimaryKeyConstraint("folder_id", "chat_id"),
    )
    op.create_index("ix_chat_folder_chats_owner", "chat_folder_chats", ["owner_id"])

    bind = op.get_bind()
    users = bind.execute(sa.text("SELECT id FROM users")).scalars().all()
    for user_id in users:
        for name in ("Коллеги", "Родители", "Знакомые"):
            bind.execute(
                sa.text(
                    "INSERT INTO friend_categories "
                    "(id, owner_id, name, is_default) VALUES (:id, :owner_id, :name, TRUE)",
                ),
                {"id": uuid.uuid4(), "owner_id": user_id, "name": name},
            )
        for name in ("Работа", "Друзья", "Семья"):
            bind.execute(
                sa.text(
                    "INSERT INTO chat_folders "
                    "(id, owner_id, name, is_default) VALUES (:id, :owner_id, :name, TRUE)",
                ),
                {"id": uuid.uuid4(), "owner_id": user_id, "name": name},
            )


def downgrade() -> None:
    op.drop_index("ix_chat_folder_chats_owner", table_name="chat_folder_chats")
    op.drop_table("chat_folder_chats")
    op.drop_index(
        "ix_friendship_categories_owner",
        table_name="friendship_categories",
    )
    op.drop_table("friendship_categories")
    op.drop_table("chat_folders")
    op.drop_table("friend_categories")
    op.drop_index("ix_friendships_high_status", table_name="friendships")
    op.drop_index("ix_friendships_low_status", table_name="friendships")
    op.drop_table("friendships")
