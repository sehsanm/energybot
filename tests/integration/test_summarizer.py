from datetime import datetime
from uuid import uuid4
import pytest
from sqlalchemy import select
from energybot.core.models import User, ChatSession, Message, ChatSummary
from energybot.chat.repository import ChatRepository
from energybot.agent.summarizer import Summarizer


class FakeRouter:
    def __init__(self, text: str = "خلاصه‌ی گفتگو"):
        self._text = text
        self.calls = 0

    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        self.calls += 1
        from energybot.providers.base import ChatResponse
        return ChatResponse(content=self._text, tokens_in=10, tokens_out=5, finish_reason="stop")


async def _seed(db_session, n_messages: int):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    await db_session.flush()
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.flush()
    for i in range(n_messages):
        db_session.add(Message(user_id=u.id, session_id=sess.id, role="user" if i % 2 == 0 else "assistant", content=f"m{i}"))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_no_summary_if_below_threshold(db_session):
    u = await _seed(db_session, n_messages=5)
    repo = ChatRepository(session_factory=lambda: db_session)
    summ = Summarizer(chat_repo=repo, router=FakeRouter(), threshold=20)
    created = await summ.maybe_summarize(u.id)
    assert created is False
    rows = (await db_session.execute(select(ChatSummary).where(ChatSummary.user_id == u.id))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_summary_created_when_threshold_crossed(db_session):
    u = await _seed(db_session, n_messages=20)
    repo = ChatRepository(session_factory=lambda: db_session)
    router = FakeRouter()
    summ = Summarizer(chat_repo=repo, router=router, threshold=20)
    created = await summ.maybe_summarize(u.id)
    assert created is True
    assert router.calls == 1
    row = (await db_session.execute(select(ChatSummary).where(ChatSummary.user_id == u.id))).scalar_one()
    assert row.text == "خلاصه‌ی گفتگو"
    assert row.covers_to_message_id > row.covers_from_message_id


@pytest.mark.asyncio
async def test_second_summary_starts_after_previous(db_session):
    u = await _seed(db_session, n_messages=20)
    repo = ChatRepository(session_factory=lambda: db_session)
    summ = Summarizer(chat_repo=repo, router=FakeRouter(text="s1"), threshold=20)
    assert await summ.maybe_summarize(u.id) is True
    sess = (await db_session.execute(select(ChatSession).where(ChatSession.user_id == u.id))).scalar_one()
    for i in range(20):
        db_session.add(Message(user_id=u.id, session_id=sess.id, role="user", content=f"x{i}"))
    await db_session.commit()
    summ2 = Summarizer(chat_repo=repo, router=FakeRouter(text="s2"), threshold=20)
    assert await summ2.maybe_summarize(u.id) is True
    rows = (await db_session.execute(select(ChatSummary).where(ChatSummary.user_id == u.id).order_by(ChatSummary.id))).scalars().all()
    assert [r.text for r in rows] == ["s1", "s2"]
    assert rows[1].covers_from_message_id > rows[0].covers_to_message_id
