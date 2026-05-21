import pytest
from energybot.kb.repository import KBRepository
from energybot.kb.publish import PublishService
from energybot.kb.retrieval import RetrievalService


class FakeRouter:
    async def embed(self, *, call_type, req):
        from energybot.providers.base import EmbeddingResponse
        out = []
        for text in req.inputs:
            base = [0.0] * 1536
            if "پکیج" in text: base[0] = 1.0
            if "ترموستات" in text: base[1] = 1.0
            if "اسپلیت" in text: base[2] = 1.0
            if "کولر" in text: base[3] = 1.0
            out.append(base)
        return EmbeddingResponse(vectors=out, tokens_in=10)


@pytest.mark.asyncio
async def test_vector_search_returns_matching_article(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a_gas = await repo.create(title="پکیج گاز", body="بهینه‌سازی پکیج. ترموستات روی ۲۱.", category="gas", tags=[], created_by=None)
    a_elec = await repo.create(title="کولر اسپلیت", body="کولر اسپلیت در مصرف برق.", category="electricity", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(a_gas)
    await svc.publish(a_elec)

    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    hits = await ret.search(query="پکیج", top_k=3, category=None)
    titles = [h["article_title"] for h in hits]
    assert "پکیج گاز" in titles
    assert titles[0] == "پکیج گاز"


@pytest.mark.asyncio
async def test_category_filter(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a_gas = await repo.create(title="گ", body="پکیج", category="gas", tags=[], created_by=None)
    a_elec = await repo.create(title="ب", body="اسپلیت", category="electricity", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(a_gas)
    await svc.publish(a_elec)
    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    hits = await ret.search(query="پکیج", top_k=3, category="electricity")
    assert all(h["category"] == "electricity" for h in hits)


@pytest.mark.asyncio
async def test_unpublished_articles_excluded(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    a = await repo.create(title="پکیج گاز", body="پکیج", category="gas", tags=[], created_by=None)
    # Do NOT publish.
    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    hits = await ret.search(query="پکیج", top_k=3, category=None)
    assert hits == []
