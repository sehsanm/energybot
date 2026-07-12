import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, OnboardingState
from energybot.onboarding import content
from energybot.agent.result import AgentResult


class FakeBale:
    def __init__(self):
        self.sent = []
        self._mid = 0
    async def send_message(self, *, chat_id, text, reply_markup=None):
        self._mid += 1
        self.sent.append({"text": text, "reply_markup": reply_markup})
        return self._mid
    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass
    async def edit_message_reply_markup(self, *, chat_id, message_id, reply_markup):
        self.sent.append({"text": None, "reply_markup": reply_markup, "edit": message_id})


class FakeAgent:
    async def handle(self, text):
        return AgentResult(text="پاسخ: " + text, suggestions=[])


def _wire(monkeypatch, bale):
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())


def _text(uid, t, i=1):
    return {"update_id": i, "message": {"message_id": i, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


def _cb(uid, data, i=1):
    return {"update_id": i, "callback_query": {"id": "cb", "from": {"id": uid},
            "message": {"message_id": 5, "chat": {"id": uid}}, "data": data}}


async def _do_profile(db_session, uid):
    await handle_bale_update(_text(uid, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(uid, ans, i), session_factory=lambda: db_session)


async def _through_motivations(db_session, uid):
    await _do_profile(db_session, uid)
    await handle_bale_update(_cb(uid, "ms:motivations:reduce_bill", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ms:motivations:__done__", 21), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_first_bill_prompt_after_motivations(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_motivations(db_session, 920)
    assert bale.sent[-1]["text"] == content.FIRST_BILL_PROMPT
    kb = bale.sent[-1]["reply_markup"]["inline_keyboard"]
    assert kb[0][0]["callback_data"] == "ob:bill:elec"


@pytest.mark.asyncio
async def test_elec_button_sends_help(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_motivations(db_session, 921)
    await handle_bale_update(_cb(921, "ob:bill:elec", 30), session_factory=lambda: db_session)
    assert bale.sent[-1]["text"] == content.FIRST_BILL_ELEC_HELP


@pytest.mark.asyncio
async def test_skip_first_bill_completes_to_home(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_motivations(db_session, 922)
    await handle_bale_update(_cb(922, "ob:bill:skip", 30), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    u = (await db_session.execute(select(User).where(User.bale_user_id == 922))).scalar_one()
    st = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert st.completed_at is not None


class _FakeRes:
    ok = True
    error = None
    summary = "خلاصه قبض"
    pay_callback = "pay:abc"
    bill_db_id = None


class _FakeBillingService:
    async def handle_input(self, user_id, **kw):
        return _FakeRes()


@pytest.mark.asyncio
async def test_captured_bill_completes_to_home(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_billing_service", lambda sf: _FakeBillingService())
    # Also stub the bill-id detector so the typed text routes to billing.
    monkeypatch.setattr("energybot.bale_adapter.handler._looks_like_bill_id", lambda t: True)
    await _through_motivations(db_session, 923)
    await handle_bale_update(_text(923, "1234567890", 30), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert any(s["text"] == HOME_TEXT for s in bale.sent)
