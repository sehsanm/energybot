from datetime import datetime, timedelta
from uuid import uuid4
import pytest
from sqlalchemy import select
from energybot.core.models import User, Message, ChatSession
from energybot.chat.repository import ChatRepository


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_first_message_opens_session(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    sid = await repo.session_for(u.id)
    sess = (await db_session.execute(select(ChatSession).where(ChatSession.id == sid))).scalar_one()
    assert sess.ended_at is None


@pytest.mark.asyncio
async def test_active_session_reused_within_window(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    s1 = await repo.session_for(u.id)
    s2 = await repo.session_for(u.id)
    assert s1 == s2


@pytest.mark.asyncio
async def test_idle_gap_closes_session_and_opens_new(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    s1 = await repo.session_for(u.id)
    sess = (await db_session.execute(select(ChatSession).where(ChatSession.id == s1))).scalar_one()
    sess.started_at = datetime.utcnow() - timedelta(hours=2)
    await db_session.commit()
    await repo.add_message(u.id, s1, role="user", content="old")
    m = (await db_session.execute(select(Message).where(Message.user_id == u.id))).scalar_one()
    m.created_at = datetime.utcnow() - timedelta(hours=1)
    await db_session.commit()
    s2 = await repo.session_for(u.id)
    assert s2 != s1


@pytest.mark.asyncio
async def test_last_n_messages_excludes_tool_rows(db_session):
    u = await _user(db_session)
    repo = ChatRepository(session_factory=lambda: db_session, idle_minutes=30)
    sid = await repo.session_for(u.id)
    await repo.add_message(u.id, sid, role="user", content="hi")
    await repo.add_message(u.id, sid, role="tool", content="", tool_name="search_kb")
    await repo.add_message(u.id, sid, role="assistant", content="سلام")
    msgs = await repo.last_n_user_assistant(u.id, n=5)
    assert [m.role for m in msgs] == ["user", "assistant"]
