from datetime import datetime
import pytest
from sqlalchemy import select

from energybot.providers.base import ChatMessage, ChatRequest, ChatResponse, ProviderError
from energybot.providers.router import ProviderRouter
from energybot.core.models import LLMCall, ModelConfig


class FakeProvider:
    def __init__(self, name, response=None, error=None):
        self.name = name
        self._response = response
        self._error = error
        self.calls = 0

    async def chat(self, req):
        self.calls += 1
        if self._error:
            raise self._error
        return self._response

    async def embed(self, req):
        raise NotImplementedError


async def _seed_active_config(db_session, call_type, provider, model_name, fallback=None):
    cfg = ModelConfig(
        call_type=call_type, provider=provider, model_name=model_name,
        params={"fallback": fallback} if fallback else {}, is_active=True,
    )
    db_session.add(cfg)
    await db_session.commit()


@pytest.mark.asyncio
async def test_router_uses_primary_provider(db_session):
    await _seed_active_config(db_session, "chat_reasoning", "frontier", "gpt-4o-mini")
    primary = FakeProvider("frontier", response=ChatResponse(content="ok", tokens_in=1, tokens_out=1, finish_reason="stop"))
    fallback = FakeProvider("metis")
    router = ProviderRouter(providers={"frontier": primary, "metis": fallback}, session_factory=lambda: db_session)
    req = ChatRequest(model="", messages=[ChatMessage(role="user", content="hi")])
    r = await router.chat(call_type="chat_reasoning", req=req)
    assert r.content == "ok"
    assert primary.calls == 1
    assert fallback.calls == 0
    rows = (await db_session.execute(select(LLMCall))).scalars().all()
    assert len(rows) == 1
    assert rows[0].status == "ok"
    assert rows[0].provider == "frontier"


@pytest.mark.asyncio
async def test_router_falls_back_on_retryable_error(db_session):
    await _seed_active_config(
        db_session, "chat_reasoning", "frontier", "gpt-4o-mini",
        fallback={"provider": "metis", "model_name": "metis-chat-pro"},
    )
    primary = FakeProvider("frontier", error=ProviderError("503", status=503, retryable=True))
    fallback = FakeProvider("metis", response=ChatResponse(content="ok-via-fallback", tokens_in=1, tokens_out=1, finish_reason="stop"))
    router = ProviderRouter(providers={"frontier": primary, "metis": fallback}, session_factory=lambda: db_session)
    r = await router.chat(call_type="chat_reasoning", req=ChatRequest(model="", messages=[ChatMessage(role="user", content="hi")]))
    assert r.content == "ok-via-fallback"
    rows = (await db_session.execute(select(LLMCall).order_by(LLMCall.id))).scalars().all()
    assert len(rows) == 2
    assert rows[0].status == "error"
    assert rows[1].status == "fallback"


@pytest.mark.asyncio
async def test_router_raises_when_both_fail(db_session):
    await _seed_active_config(
        db_session, "chat_reasoning", "frontier", "gpt-4o-mini",
        fallback={"provider": "metis", "model_name": "metis-chat-pro"},
    )
    primary = FakeProvider("frontier", error=ProviderError("503", status=503, retryable=True))
    fallback = FakeProvider("metis", error=ProviderError("503", status=503, retryable=True))
    router = ProviderRouter(providers={"frontier": primary, "metis": fallback}, session_factory=lambda: db_session)
    with pytest.raises(ProviderError):
        await router.chat(call_type="chat_reasoning", req=ChatRequest(model="", messages=[ChatMessage(role="user", content="hi")]))
