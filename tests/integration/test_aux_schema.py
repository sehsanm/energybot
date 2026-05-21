import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_aux_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('llm_calls','processed_updates','daily_stats')"
    ))
    assert {r[0] for r in rows} == {"llm_calls", "processed_updates", "daily_stats"}
