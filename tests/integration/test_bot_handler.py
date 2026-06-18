import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, OnboardingState, Profile


class FakeBale:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1

    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass


class FakeAgent:
    async def handle(self, text): return "پاسخ دستیار: " + text


@pytest.mark.asyncio
async def test_new_user_triggers_onboarding_wizard(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())
    upd = {"update_id": 1, "message": {"message_id": 1, "from": {"id": 555, "first_name": "تست"}, "chat": {"id": 555}, "text": "/start"}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 555))).scalar_one()
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.current_step == "city"
    assert any("شهر" in s["text"] for s in bale.sent)


@pytest.mark.asyncio
async def test_real_question_mid_wizard_abandons_wizard(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())
    upd_start = {"update_id": 10, "message": {"message_id": 1, "from": {"id": 777}, "chat": {"id": 777}, "text": "/start"}}
    await handle_bale_update(upd_start, session_factory=lambda: db_session)
    upd_q = {"update_id": 11, "message": {"message_id": 2, "from": {"id": 777}, "chat": {"id": 777}, "text": "قبض گازم چرا بالاست؟"}}
    await handle_bale_update(upd_q, session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 777))).scalar_one()
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.completed_at is not None
    assert any("پاسخ دستیار" in s["text"] for s in bale.sent)
