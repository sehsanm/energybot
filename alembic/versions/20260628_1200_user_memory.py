"""user memory table

Revision ID: f6a1b2c3d4e5
Revises: e5f6a1b2c3d4
Create Date: 2026-06-28 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision: str = "f6a1b2c3d4e5"
down_revision: str | None = "e5f6a1b2c3d4"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "user_memories",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("source_message_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_memories_user", "user_memories", ["user_id", "deleted_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_memories_user", table_name="user_memories")
    op.drop_table("user_memories")
