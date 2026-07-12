import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, Profile
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


@pytest.mark.asyncio
async def test_motivations_widget_shown_after_profile(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _do_profile(db_session, 910)
    from energybot.onboarding.content import MOTIVATIONS_PROMPT
    assert bale.sent[-1]["text"] == MOTIVATIONS_PROMPT
    assert bale.sent[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"].startswith("ms:motivations:")


@pytest.mark.asyncio
async def test_motivations_commit_writes_profile(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _do_profile(db_session, 911)
    await handle_bale_update(_cb(911, "ms:motivations:reduce_bill", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(911, "ms:motivations:earn_rewards", 21), session_factory=lambda: db_session)
    await handle_bale_update(_cb(911, "ms:motivations:earn_rewards", 22), session_factory=lambda: db_session)  # toggle off
    await handle_bale_update(_cb(911, "ms:motivations:__done__", 23), session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 911))).scalar_one()
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.behaviour.get("motivations") == ["reduce_bill"]
