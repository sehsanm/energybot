import pytest
from sqlalchemy import select
from uuid import uuid4
from energybot.core.models import User, Profile, Message, ChatSession
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository
from energybot.agent.tools.read_profile import ReadProfileTool
from energybot.agent.tools.update_profile import UpdateProfileTool
from energybot.agent.tools.record_commitment import RecordCommitmentTool
from energybot.agent.tools.escalate import EscalateTool


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_read_profile_returns_dict(db_session):
    u = await _user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    tool = ReadProfileTool(repo=repo, user_id=u.id)
    result = await tool.invoke({})
    assert result["household"]["city"] == "تهران"


@pytest.mark.asyncio
async def test_update_profile_writes_event(db_session):
    u = await _user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    tool = UpdateProfileTool(repo=repo, user_id=u.id, current_message_id=None)
    await tool.invoke({"path": "behaviour.peak_usage_hours", "value": "18-22", "reason": "user said"})
    p = await repo.get(u.id)
    assert p.behaviour["peak_usage_hours"] == "18-22"


@pytest.mark.asyncio
async def test_record_commitment_appends(db_session):
    u = await _user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    tool = RecordCommitmentTool(repo=repo, user_id=u.id, current_message_id=None)
    out = await tool.invoke({"text": "ترموستات روی ۲۱", "target_date": "2026-06-01"})
    assert out["commitment_id"] is not None
    p = await repo.get(u.id)
    assert any("ترموستات" in c["text"] for c in p.commitments)


@pytest.mark.asyncio
async def test_escalate_flags_messages(db_session):
    u = await _user(db_session)
    chat = ChatRepository(session_factory=lambda: db_session)
    sid = await chat.session_for(u.id)
    mid = await chat.add_message(u.id, sid, role="user", content="کمک می‌خواهم")
    tool = EscalateTool(chat=chat, user_id=u.id, current_message_id=mid)
    await tool.invoke({"reason": "خارج از حوزه"})
    m = (await db_session.execute(select(Message).where(Message.id == mid))).scalar_one()
    assert m.meta.get("flagged") is True
