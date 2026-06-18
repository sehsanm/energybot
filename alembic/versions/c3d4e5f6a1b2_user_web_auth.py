"""user web auth tables

Revision ID: c3d4e5f6a1b2
Revises: a1b2c3d4e5f6
Create Date: 2026-06-18 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID as PGUUID

revision: str = "c3d4e5f6a1b2"
down_revision: str | None = "a1b2c3d4e5f6"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "web_login_tokens",
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("token_hash"),
    )
    op.create_index(op.f("ix_web_login_tokens_user_id"), "web_login_tokens", ["user_id"])
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.String(length=128), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("issued_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_sessions_user_id"), "user_sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_user_sessions_user_id"), table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index(op.f("ix_web_login_tokens_user_id"), table_name="web_login_tokens")
    op.drop_table("web_login_tokens")
