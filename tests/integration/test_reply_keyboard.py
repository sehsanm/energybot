import pytest
from energybot.bale_adapter.handler import handle_bale_update
from energybot.agent.result import AgentResult


class FakeBale:
    def __init__(self):
        self.sent = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1

    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass


class FakeAgent:
    def __init__(self): self.calls = []
    async def handle(self, text):
        self.calls.append(text)
        return AgentResult(text="پاسخ: " + text, suggestions=[])


def _text(uid, t, update_id=1):
    return {"update_id": update_id, "message": {"message_id": update_id, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


@pytest.fixture
def wired(monkeypatch):
    bale = FakeBale()
    agent = FakeAgent()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: agent)
    return bale, agent


async def _onboard(db_session, uid):
    await handle_bale_update(_text(uid, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(uid, ans, i), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_reply_kb_label_routes_to_home_not_agent(db_session, wired):
    bale, agent = wired
    await _onboard(db_session, 950)
    bale.sent.clear()
    await handle_bale_update(_text(950, "راهنما", 50), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert agent.calls == []  # label intercepted, never reached the agent


@pytest.mark.asyncio
async def test_reply_kb_bill_label_sends_bill_prompt(db_session, wired):
    bale, agent = wired
    await _onboard(db_session, 951)
    bale.sent.clear()
    await handle_bale_update(_text(951, "قبض من", 60), session_factory=lambda: db_session)
    assert "قبض" in bale.sent[-1]["text"]
    assert agent.calls == []


@pytest.mark.asyncio
async def test_reply_kb_profile_label_routes_to_profile(db_session, wired):
    bale, agent = wired
    await _onboard(db_session, 952)
    bale.sent.clear()
    await handle_bale_update(_text(952, "پروفایل", 70), session_factory=lambda: db_session)
    assert agent.calls == []
    assert len(bale.sent) >= 1
    assert bale.sent[-1]["text"]  # non-empty profile summary was sent


@pytest.mark.asyncio
async def test_reply_kb_web_label_routes_to_web(db_session, wired):
    bale, agent = wired
    await _onboard(db_session, 953)
    bale.sent.clear()
    await handle_bale_update(_text(953, "نسخه وب", 80), session_factory=lambda: db_session)
    assert agent.calls == []
    assert "وب" in bale.sent[-1]["text"]
