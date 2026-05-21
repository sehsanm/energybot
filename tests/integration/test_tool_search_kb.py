import pytest
from energybot.kb.repository import KBRepository
from energybot.kb.publish import PublishService
from energybot.kb.retrieval import RetrievalService
from energybot.agent.tools.search_kb import SearchKBTool


class FakeRouter:
    async def embed(self, *, call_type, req):
        from energybot.providers.base import EmbeddingResponse
        return EmbeddingResponse(vectors=[[1.0] + [0.0] * 1535 for _ in req.inputs], tokens_in=1)


@pytest.mark.asyncio
async def test_search_kb_tool_runs(db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="پکیج", body="پکیج گاز را تنظیم کنید.", category="gas", tags=[], created_by=None)
    await PublishService(repo=repo, router=FakeRouter(), session_factory=lambda: db_session).publish(aid)
    ret = RetrievalService(router=FakeRouter(), session_factory=lambda: db_session)
    tool = SearchKBTool(retrieval=ret)
    result = await tool.invoke({"query": "پکیج", "top_k": 3})
    assert isinstance(result, list)
    assert result[0]["article_title"] == "پکیج"
