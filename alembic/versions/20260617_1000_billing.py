"""billing tables

Revision ID: a1b2c3d4e5f6
Revises: 22c6dee42c26
Create Date: 2026-06-17 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "22c6dee42c26"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "utility_subscriptions",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("utility_type", sa.String(length=20), nullable=False),
        sa.Column("bill_id", sa.String(length=20), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "bill_id", name="uq_subscription_user_bill"),
    )
    op.create_index(op.f("ix_utility_subscriptions_user_id"), "utility_subscriptions", ["user_id"])
    op.create_table(
        "bills",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("subscription_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("utility_type", sa.String(length=20), nullable=False),
        sa.Column("pay_id", sa.String(length=20), nullable=True),
        sa.Column("amount", sa.Numeric(precision=14, scale=0), nullable=False),
        sa.Column("term", sa.String(length=40), nullable=True),
        sa.Column("consumption", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'inquired'"), nullable=False),
        sa.Column("raw_inquiry", JSONB(), nullable=False),
        sa.Column("inquired_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subscription_id"], ["utility_subscriptions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bills_user_inquired", "bills", ["user_id", "inquired_at"])
    op.create_table(
        "bill_payments",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("bill_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=0), nullable=False),
        sa.Column("status", sa.String(length=20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("gateway_ref", sa.String(length=120), nullable=True),
        sa.Column("redirect_url", sa.Text(), nullable=True),
        sa.Column("raw", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["bill_id"], ["bills.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bill_payments_gateway_ref"), "bill_payments", ["gateway_ref"])


def downgrade() -> None:
    op.drop_index(op.f("ix_bill_payments_gateway_ref"), table_name="bill_payments")
    op.drop_table("bill_payments")
    op.drop_index("ix_bills_user_inquired", table_name="bills")
    op.drop_table("bills")
    op.drop_index(op.f("ix_utility_subscriptions_user_id"), table_name="utility_subscriptions")
    op.drop_table("utility_subscriptions")
