from uuid import uuid4
import pytest
from energybot.core.models import User, Profile
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository
from energybot.agent.context import ContextAssembler


class FakePromptLoader:
    async def render(self, key, vars):
        return ("سیستم: " + vars["profile_summary"][:30], key, 1)


@pytest.mark.asyncio
async def test_assemble_includes_system_profile_summary_and_recent(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    chat = ChatRepository(session_factory=lambda: db_session)
    sid = await chat.session_for(u.id)
    await chat.add_message(u.id, sid, role="user", content="سلام")
    await chat.add_message(u.id, sid, role="assistant", content="درود")
    prof_repo = ProfileRepository(session_factory=lambda: db_session)
    asm = ContextAssembler(prompt_loader=FakePromptLoader(), profile_repo=prof_repo, chat_repo=chat)
    ctx = await asm.assemble(u.id, "این پیام جدید")
    assert ctx.system.startswith("سیستم:")
    assert ctx.prompt_template_key == "system_prompt"
    assert ctx.prompt_template_version == 1
    roles = [m.role for m in ctx.messages]
    assert roles == ["system", "user", "assistant", "user"]
    assert ctx.messages[-1].content == "این پیام جدید"
