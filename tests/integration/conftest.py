import pytest
from sqlalchemy import text


@pytest.fixture(autouse=True)
async def clean_router_tables(db_session):
    """Remove seeded rows before and after each test to prevent unique-constraint violations
    across tests that share the same key/call_type."""
    # Clean before the test in case a previous run left data
    await db_session.execute(text("DELETE FROM llm_calls"))
    await db_session.execute(text("DELETE FROM model_configs"))
    await db_session.execute(text("DELETE FROM prompt_templates"))
    # Children first to avoid FK violations
    await db_session.execute(text("DELETE FROM messages"))
    await db_session.execute(text("DELETE FROM chat_summaries"))
    await db_session.execute(text("DELETE FROM chat_sessions"))
    await db_session.execute(text("DELETE FROM profile_events"))
    await db_session.execute(text("DELETE FROM onboarding_states"))
    await db_session.execute(text("DELETE FROM profiles"))
    await db_session.execute(text("DELETE FROM users"))
    await db_session.commit()
    yield
    # Clean after: rollback any failed transaction first, then delete
    try:
        await db_session.rollback()
    except Exception:
        pass
    await db_session.execute(text("DELETE FROM llm_calls"))
    await db_session.execute(text("DELETE FROM model_configs"))
    await db_session.execute(text("DELETE FROM prompt_templates"))
    # Children first to avoid FK violations
    await db_session.execute(text("DELETE FROM messages"))
    await db_session.execute(text("DELETE FROM chat_summaries"))
    await db_session.execute(text("DELETE FROM chat_sessions"))
    await db_session.execute(text("DELETE FROM profile_events"))
    await db_session.execute(text("DELETE FROM onboarding_states"))
    await db_session.execute(text("DELETE FROM profiles"))
    await db_session.execute(text("DELETE FROM users"))
    await db_session.commit()
