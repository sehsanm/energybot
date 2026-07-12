import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, Profile, OnboardingState
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


async def _through_first_bill_skip(db_session, uid):
    await _do_profile(db_session, uid)
    await handle_bale_update(_cb(uid, "ms:motivations:__done__", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ob:bill:skip", 21), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_toolbox_shown_after_first_bill(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_first_bill_skip(db_session, 930)
    assert bale.sent[-1]["text"] == content.TOOLBOX_PROMPT
    assert bale.sent[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"].startswith("ms:toolbox:")


@pytest.mark.asyncio
async def test_toolbox_commit_persists_and_completes(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_first_bill_skip(db_session, 931)
    await handle_bale_update(_cb(931, "ms:toolbox:daily_reminder", 30), session_factory=lambda: db_session)
    await handle_bale_update(_cb(931, "ms:toolbox:weekly_summary", 31), session_factory=lambda: db_session)
    await handle_bale_update(_cb(931, "ms:toolbox:__done__", 32), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    u = (await db_session.execute(select(User).where(User.bale_user_id == 931))).scalar_one()
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert set(p.service_prefs) == {"daily_reminder", "weekly_summary"}
    st = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert st.completed_at is not None


@pytest.mark.asyncio
async def test_toolbox_skip_completes_with_empty_prefs(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_first_bill_skip(db_session, 932)
    await handle_bale_update(_cb(932, "ms:toolbox:__skip__", 30), session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 932))).scalar_one()
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.service_prefs == []
