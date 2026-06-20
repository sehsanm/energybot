import os
import pytest
from energybot.core.models import User, Profile

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


class _StubRouter:
    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        from energybot.providers.base import ChatResponse
        # tool_calls defaults to [] (falsy → loop exits after one turn); finish_reason is required.
        return ChatResponse(content="پاسخ آزمایشی", tokens_in=1, tokens_out=1, finish_reason="stop", model="stub")


@pytest.mark.asyncio
async def test_build_agent_handles_message_with_webchannel(monkeypatch, db_session):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "x")
    monkeypatch.setenv("BALE_BOT_TOKEN", "t")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    from energybot.settings import get_settings
    get_settings.cache_clear()

    u = User(bale_user_id=424242)
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()

    # Force the agent's provider router to our stub (no real LLM, no prompt rendering needed for content).
    import energybot.agent.builder as builder
    monkeypatch.setattr(builder, "ProviderRouter", lambda **kw: _StubRouter())

    # No prompt_templates rows exist in the clean test DB; monkeypatch render to avoid LookupError.
    from energybot.agent import prompts as _prompts_mod
    async def _stub_render(self, key, vars):
        return ("sys", key, 1)
    monkeypatch.setattr(_prompts_mod.PromptLoader, "render", _stub_render)

    from energybot.agent.channels import WebChannel
    def sf():
        return db_session
    from energybot.agent.result import AgentResult
    agent = builder.build_agent(user_id=u.id, channel=WebChannel(), session_factory=sf)
    reply = await agent.handle("سلام")
    assert isinstance(reply, AgentResult)
    assert reply.text == "پاسخ آزمایشی"
