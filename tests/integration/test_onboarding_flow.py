import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, OnboardingState
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
    async def handle(self, text):
        return AgentResult(text="پاسخ: " + text, suggestions=[])


def _wire(monkeypatch, bale):
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())


def _text(uid, t, update_id=1):
    return {"update_id": update_id, "message": {"message_id": update_id, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


def _cb(uid, data, update_id=1):
    return {"update_id": update_id, "callback_query": {"id": "cb1", "from": {"id": uid},
            "message": {"message_id": 1, "chat": {"id": uid}}, "data": data}}


@pytest.mark.asyncio
async def test_first_message_non_start_triggers_intro_and_wizard(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    # Brand-new user opens with a greeting, NOT /start.
    await handle_bale_update(_text(901, "سلام"), session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 901))).scalar_one()
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.current_step == "city"
    from energybot.bale_adapter.home import INTRO_TEXT
    assert any(s["text"] == INTRO_TEXT for s in bale.sent)
    assert any("شهر" in s["text"] for s in bale.sent)


@pytest.mark.asyncio
async def test_returning_user_start_shows_home_not_wizard(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    # Onboard fully first.
    await handle_bale_update(_text(902, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(902, ans, i), session_factory=lambda: db_session)
    bale.sent.clear()
    # Now /start again -> home screen with reply keyboard, no new wizard step.
    await handle_bale_update(_text(902, "/start", 99), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert bale.sent[-1]["reply_markup"]["keyboard"]


@pytest.mark.asyncio
async def test_help_shows_home(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    # Make the user non-new so /help isn't swallowed by first-contact onboarding.
    await handle_bale_update(_text(903, "/start", 1), session_factory=lambda: db_session)
    bale.sent.clear()
    await handle_bale_update(_text(903, "/help", 2), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert bale.sent[-1]["reply_markup"]["keyboard"]


@pytest.mark.asyncio
async def test_wizard_completion_shows_home(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    await handle_bale_update(_text(904, "/start", 1), session_factory=lambda: db_session)
    answers = ["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"]
    for i, ans in enumerate(answers, start=2):
        await handle_bale_update(_text(904, ans, i), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert bale.sent[-1]["reply_markup"]["keyboard"]


@pytest.mark.asyncio
async def test_wizard_completion_via_callback_shows_home(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    uid = 905
    # Start onboarding: first message triggers intro + asks city (text-only step).
    await handle_bale_update(_text(uid, "/start", 1), session_factory=lambda: db_session)
    # Answer city via text (city has no inline buttons).
    await handle_bale_update(_text(uid, "تهران", 2), session_factory=lambda: db_session)
    # Answer the remaining 6 wizard steps via callback button presses.
    cb_answers = [
        "آپارتمان",   # home_type
        "2",           # occupants
        "60-100",      # area_m2
        "پکیج",        # heating_type
        "اسپلیت",      # cooling_type
        "کاهش قبض برق",  # main_concern
    ]
    for i, val in enumerate(cb_answers, start=3):
        await handle_bale_update(_cb(uid, val, update_id=i), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert bale.sent[-1]["reply_markup"]["keyboard"]
