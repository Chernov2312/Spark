"""Add stable, unique user tags and allow repeated display names.

Revision ID: 6d4a2b1c9f80
Revises: 3b4f44e5fc61
"""
import re
import unicodedata

from alembic import op
import sqlalchemy as sa

revision = "6d4a2b1c9f80"
down_revision = "3b4f44e5fc61"
branch_labels = None
depends_on = None

_CONFUSABLES = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y",
    "х": "x", "к": "k", "м": "m", "т": "t", "в": "b", "н": "h",
    "і": "i", "ј": "j", "ѕ": "s", "Α": "a", "Β": "b", "Ε": "e",
    "Ζ": "z", "Η": "h", "Ι": "i", "Κ": "k", "Μ": "m", "Ν": "n",
    "Ο": "o", "Ρ": "p", "Τ": "t", "Υ": "y", "Χ": "x", "α": "a",
    "β": "b", "ε": "e", "ι": "i", "κ": "k", "ο": "o", "ρ": "p",
    "τ": "t", "υ": "y", "χ": "x",
    "б": "b", "г": "g", "д": "d", "ё": "e", "ж": "zh", "з": "z",
    "й": "i", "л": "l", "ф": "f", "ц": "c", "ч": "ch", "ш": "sh",
    "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu",
    "я": "ya",
})


def _tag(name: str) -> str:
    value = unicodedata.normalize("NFKC", name).translate(_CONFUSABLES).casefold()
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9_]", "", value)[:32].strip("_") or "user"


def upgrade() -> None:
    op.add_column("users", sa.Column("tag", sa.String(length=32), nullable=True))
    bind = op.get_bind()
    rows = bind.execute(sa.text("SELECT id, username FROM users ORDER BY created_at, id")).all()
    used = set()
    for user_id, username in rows:
        base = _tag(username)
        candidate = base
        suffix = 1
        while candidate in used:
            suffix += 1
            tail = str(suffix)
            candidate = f"{base[:32-len(tail)]}{tail}"
        used.add(candidate)
        bind.execute(sa.text("UPDATE users SET tag = :tag WHERE id = :id"), {"tag": candidate, "id": user_id})
    op.alter_column("users", "tag", nullable=False)
    op.create_index("ix_users_tag", "users", ["tag"], unique=True)
    op.drop_constraint("users_username_key", "users", type_="unique")


def downgrade() -> None:
    op.create_unique_constraint("users_username_key", "users", ["username"])
    op.drop_index("ix_users_tag", table_name="users")
    op.drop_column("users", "tag")
