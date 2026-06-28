import pytest
from uuid import uuid4
from energybot.core.models import User, Profile
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository
from energybot.memory.repository import MemoryRepository
from energybot.agent.context import ContextAssembler
from energybot.agent.tools.base import ToolRegistry
from energybot.agent.loop import AgentLoop
from energybot.providers.base import ChatResponse


class FakeLoader:
    async def render(self, key, vars):
        return ("سیستم", key, 1)


class FakeRouter:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls = 0

    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        self.calls += 1
        return self._responses.pop(0)


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_simple_turn_no_tools(db_session):
    u = await _user(db_session)
    asm = ContextAssembler(prompt_loader=FakeLoader(),
                           profile_repo=ProfileRepository(session_factory=lambda: db_session),
                           chat_repo=ChatRepository(session_factory=lambda: db_session),
                           memory_repo=MemoryRepository(session_factory=lambda: db_session))
    router = FakeRouter([ChatResponse(content="درود", tokens_in=10, tokens_out=2, finish_reason="stop")])
    loop = AgentLoop(router=router, context_assembler=asm, chat_repo=ChatRepository(session_factory=lambda: db_session),
                     tool_registry=ToolRegistry(), summarizer=None, tool_iteration_cap=6, user_id=u.id)
    reply = await loop.handle_message("سلام")
    assert reply == "درود"


@pytest.mark.asyncio
async def test_tool_iteration_cap(db_session):
    u = await _user(db_session)
    asm = ContextAssembler(prompt_loader=FakeLoader(),
                           profile_repo=ProfileRepository(session_factory=lambda: db_session),
                           chat_repo=ChatRepository(session_factory=lambda: db_session),
                           memory_repo=MemoryRepository(session_factory=lambda: db_session))
    tool_resp = lambda i: ChatResponse(
        content="", tokens_in=1, tokens_out=1, finish_reason="tool_calls",
        tool_calls=[{"id": f"t{i}", "type": "function", "function": {"name": "read_profile", "arguments": "{}"}}],
    )
    final = ChatResponse(content="پاسخ نهایی", tokens_in=1, tokens_out=1, finish_reason="stop")
    router = FakeRouter([tool_resp(i) for i in range(6)] + [final])
    registry = ToolRegistry()

    class DummyRead:
        name = "read_profile"
        description = ""
        parameters = {"type": "object", "properties": {}}
        async def invoke(self, args): return {}

    registry.register(DummyRead())

    loop = AgentLoop(router=router, context_assembler=asm, chat_repo=ChatRepository(session_factory=lambda: db_session),
                     tool_registry=registry, summarizer=None, tool_iteration_cap=6, user_id=u.id)
    reply = await loop.handle_message("ببین چی")
    assert reply == "پاسخ نهایی"
    assert router.calls == 7
