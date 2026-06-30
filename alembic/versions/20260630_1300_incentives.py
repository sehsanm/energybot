"""incentive params and city climate zones

Revision ID: a7b8c9d0e1f2
Revises: f6a1b2c3d4e5
Create Date: 2026-06-30 13:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

revision: str = "a7b8c9d0e1f2"
down_revision: str | None = "f6a1b2c3d4e5"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "incentive_param_set",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("effective_year", sa.Integer(), nullable=False),
        sa.Column("climate_zone", sa.String(length=40), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("params", JSONB(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("effective_year", "climate_zone", name="uq_incentive_year_zone"),
    )
    op.create_table(
        "city_climate_zone",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("city_name", sa.String(length=120), nullable=False),
        sa.Column("province", sa.String(length=120), nullable=True),
        sa.Column("climate_zone", sa.String(length=40), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("city_name", name="uq_city_climate_zone_city"),
    )
    op.create_index("ix_city_climate_zone_city", "city_climate_zone", ["city_name"])


def downgrade() -> None:
    op.drop_index("ix_city_climate_zone_city", table_name="city_climate_zone")
    op.drop_table("city_climate_zone")
    op.drop_table("incentive_param_set")
