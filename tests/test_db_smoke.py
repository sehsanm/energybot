import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_db_reachable(db_session):
    r = await db_session.execute(text("SELECT 1 AS one"))
    assert r.scalar_one() == 1


@pytest.mark.asyncio
async def test_pgvector_extension_present(db_session):
    r = await db_session.execute(text("SELECT extname FROM pg_extension WHERE extname='vector'"))
    assert r.scalar_one() == "vector"


@pytest.mark.asyncio
async def test_pg_trgm_extension_present(db_session):
    r = await db_session.execute(text("SELECT extname FROM pg_extension WHERE extname='pg_trgm'"))
    assert r.scalar_one() == "pg_trgm"
