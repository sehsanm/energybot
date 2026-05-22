import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_kb_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_name IN ('kb_articles','kb_attachments','video_transcripts','kb_chunks')"
    ))
    assert {r[0] for r in rows} == {"kb_articles", "kb_attachments", "video_transcripts", "kb_chunks"}


@pytest.mark.asyncio
async def test_kb_chunks_has_hnsw_index(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes WHERE tablename='kb_chunks'"
    ))
    defs = [row[0] for row in r]
    assert any("hnsw" in d.lower() for d in defs)
    assert any("gin" in d.lower() and "text_normalized" in d for d in defs)
