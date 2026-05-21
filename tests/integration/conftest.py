import pytest
from sqlalchemy import text


@pytest.fixture(autouse=True)
async def clean_router_tables(db_session):
    """Remove seeded model_configs and llm_calls rows before and after each test to prevent
    unique-constraint violations across tests that share the same call_type."""
    # Clean before the test in case a previous run left data
    await db_session.execute(text("DELETE FROM llm_calls"))
    await db_session.execute(text("DELETE FROM model_configs"))
    await db_session.commit()
    yield
    # Clean after: rollback any failed transaction first, then delete
    try:
        await db_session.rollback()
    except Exception:
        pass
    await db_session.execute(text("DELETE FROM llm_calls"))
    await db_session.execute(text("DELETE FROM model_configs"))
    await db_session.commit()
