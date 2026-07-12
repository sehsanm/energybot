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
    async def edit_message_reply_markup(self, *, chat_id, message_id, reply_markup):
        self.sent.append({"chat_id": chat_id, "text": None, "reply_markup": reply_markup, "edit": message_id})


class FakeAgent:
    def __init__(self, suggestions):
        self._suggestions = suggestions
        self.calls = []

    async def handle(self, text):
        self.calls.append(text)
        return AgentResult(text="پاسخ: " + text, suggestions=list(self._suggestions))


def _text(uid, t, update_id=1):
    return {"update_id": update_id, "message": {"message_id": update_id, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


def _cb(uid, data, update_id=1):
    return {"update_id": update_id, "callback_query": {"id": "cb1", "from": {"id": uid},
            "message": {"message_id": 1, "chat": {"id": uid}}, "data": data}}


async def _onboard(db_session, uid):
    await handle_bale_update(_text(uid, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(uid, ans, i), session_factory=lambda: db_session)
    # Commit the motivations phase, skip the first-bill prompt, then skip the
    # toolbox phase too, so onboarding is fully done and later messages in
    # these tests reach the agent rather than re-showing a widget.
    await handle_bale_update(_cb(uid, "ms:motivations:reduce_bill", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ms:motivations:__done__", 21), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ob:bill:skip", 22), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ms:toolbox:__skip__", 23), session_factory=lambda: db_session)


def _wire(monkeypatch, bale, agent):
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: agent)


@pytest.mark.asyncio
async def test_chat_reply_attaches_inline_suggestions(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=["query_bill", "saving_tips"])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 960)
    bale.sent.clear()
    await handle_bale_update(_text(960, "قبض گازم چرا زیاده؟", 40), session_factory=lambda: db_session)
    last = bale.sent[-1]
    assert last["text"].startswith("پاسخ:")
    cbs = [b["callback_data"] for row in last["reply_markup"]["inline_keyboard"] for b in row]
    assert cbs == ["act:query_bill", "act:saving_tips"]


@pytest.mark.asyncio
async def test_no_suggestions_means_no_markup(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=[])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 961)
    bale.sent.clear()
    await handle_bale_update(_text(961, "سلام", 40), session_factory=lambda: db_session)
    assert bale.sent[-1]["reply_markup"] is None


@pytest.mark.asyncio
async def test_act_callback_routes_to_bill_prompt(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=[])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 962)
    bale.sent.clear()
    await handle_bale_update(_cb(962, "act:query_bill", 41), session_factory=lambda: db_session)
    assert "قبض" in bale.sent[-1]["text"]
    assert agent.calls == []  # system action, not an agent prompt


@pytest.mark.asyncio
async def test_act_callback_prompt_kind_calls_agent(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=[])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 963)
    bale.sent.clear()
    await handle_bale_update(_cb(963, "act:saving_tips", 42), session_factory=lambda: db_session)
    from energybot.bale_adapter.actions import CATALOG
    assert agent.calls == [CATALOG["saving_tips"].prompt]
    assert bale.sent[-1]["text"].startswith("پاسخ:")


@pytest.mark.asyncio
async def test_act_callback_unknown_key_is_noop(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=[])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 964)
    bale.sent.clear()
    await handle_bale_update(_cb(964, "act:__bogus__", 43), session_factory=lambda: db_session)
    assert agent.calls == []
    assert bale.sent == []
