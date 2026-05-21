import pytest
from sqlalchemy import select
from energybot.core.models import KBArticle
from energybot.kb.repository import KBRepository


@pytest.mark.asyncio
async def test_create_article_starts_as_draft(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="بهینه‌سازی پکیج", body="متن", category="gas", tags=["پکیج"], created_by=None)
    row = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert row.status == "draft"
    assert row.version == 1
    assert row.category == "gas"


@pytest.mark.asyncio
async def test_update_body_bumps_version_and_keeps_draft(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="t", body="b1", category="general", tags=[], created_by=None)
    await repo.update(aid, body="b2")
    row = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert row.body == "b2"
    assert row.version == 2
    assert row.status == "draft"


@pytest.mark.asyncio
async def test_soft_delete_excludes_from_list(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a1 = await repo.create(title="a", body="x", category="gas", tags=[], created_by=None)
    a2 = await repo.create(title="b", body="y", category="gas", tags=[], created_by=None)
    await repo.soft_delete(a1)
    visible = await repo.list_visible()
    assert {r.id for r in visible} == {a2}
    trashed = await repo.list_trashed()
    assert {r.id for r in trashed} == {a1}
