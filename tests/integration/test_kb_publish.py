import pytest
from sqlalchemy import select
from energybot.core.models import KBArticle, KBChunk
from energybot.kb.repository import KBRepository
from energybot.kb.publish import PublishService


class FakeRouter:
    def __init__(self, fail_on=None):
        self._fail = fail_on
        self.calls = 0

    async def embed(self, *, call_type, req):
        self.calls += 1
        if self._fail == "embed":
            from energybot.providers.base import ProviderError
            raise ProviderError("embed boom", retryable=True)
        from energybot.providers.base import EmbeddingResponse
        return EmbeddingResponse(vectors=[[0.01 * i for i in range(1536)] for _ in req.inputs], tokens_in=10)


@pytest.mark.asyncio
async def test_publish_chunks_embeds_and_marks_published(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="پکیج", body="متن کافی برای حداقل یک چانک.", category="gas", tags=["پکیج"], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(aid)
    art = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert art.status == "published"
    chunks = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    assert len(chunks) >= 1
    assert len(chunks[0].embedding) == 1536


@pytest.mark.asyncio
async def test_republish_replaces_chunks_atomically(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="نسخه ۱", category="general", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session)
    await svc.publish(aid)
    first = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    first_ids = {c.id for c in first}
    await repo.update(aid, body="نسخه ۲ که خیلی طولانی‌تر است. " * 80)
    await svc.publish(aid)
    second = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    second_ids = {c.id for c in second}
    assert first_ids.isdisjoint(second_ids)


@pytest.mark.asyncio
async def test_embed_failure_rolls_back_publish(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="متن", category="general", tags=[], created_by=None)
    svc = PublishService(repo=repo, router=FakeRouter(fail_on="embed"), session_factory=lambda: db_session)
    with pytest.raises(Exception):
        await svc.publish(aid)
    art = (await db_session.execute(select(KBArticle).where(KBArticle.id == aid))).scalar_one()
    assert art.status == "draft"
    chunks = (await db_session.execute(select(KBChunk).where(KBChunk.article_id == aid))).scalars().all()
    assert chunks == []
