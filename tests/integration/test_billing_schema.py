import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_billing_tables_exist(db_session):
    rows = (await db_session.execute(text(
        "select table_name from information_schema.tables where table_schema='public'"
    ))).scalars().all()
    assert {"utility_subscriptions", "bills", "bill_payments"} <= set(rows)
