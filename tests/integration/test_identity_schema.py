import pytest
from sqlalchemy import text


@pytest.mark.asyncio
async def test_identity_tables_exist(db_session):
    rows = await db_session.execute(text(
        "SELECT table_name FROM information_schema.tables "
        "WHERE table_schema='public' AND table_name IN "
        "('users','profiles','profile_events','onboarding_states')"
    ))
    names = {r[0] for r in rows}
    assert names == {"users", "profiles", "profile_events", "onboarding_states"}


@pytest.mark.asyncio
async def test_users_has_bale_user_id_unique(db_session):
    r = await db_session.execute(text(
        "SELECT indexdef FROM pg_indexes "
        "WHERE tablename='users' AND indexdef ILIKE '%bale_user_id%'"
    ))
    defs = [row[0] for row in r]
    assert any("UNIQUE" in d for d in defs)
