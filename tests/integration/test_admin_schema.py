import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_admin_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('admin_users','admin_sessions','prompt_templates','model_configs','audit_log')"
    ))
    assert {r[0] for r in rows} == {"admin_users", "admin_sessions", "prompt_templates", "model_configs", "audit_log"}


@pytest.mark.asyncio
async def test_one_active_prompt_per_key(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='prompt_templates'"
    ))
    defs = [row[0] for row in r]
    assert any("UNIQUE" in d and "key" in d and "status" in d for d in defs)


@pytest.mark.asyncio
async def test_one_active_model_per_call_type(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='model_configs'"
    ))
    defs = [row[0] for row in r]
    assert any("UNIQUE" in d and "call_type" in d for d in defs)
