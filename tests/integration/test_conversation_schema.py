import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_conversation_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('chat_sessions','messages','chat_summaries')"
    ))
    assert {r[0] for r in rows} == {"chat_sessions", "messages", "chat_summaries"}


@pytest.mark.asyncio
async def test_messages_index_on_user_created(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='messages'"
    ))
    defs = [row[0] for row in r]
    assert any("user_id" in d and "created_at" in d for d in defs)
