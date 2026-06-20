import os
import pytest
from sqlalchemy import select
from energybot.core.models import User, WebLoginToken

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


class _FakeBale:
    def __init__(self):
        self.sent = []

    async def send_chat_action(self, **kw):
        pass

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1


@pytest.fixture
def fake_bale(monkeypatch):
    fb = _FakeBale()
    import energybot.bale_adapter.handler as h
    monkeypatch.setattr(h, "get_bale_client", lambda: fb)
    return fb


@pytest.mark.asyncio
async def test_web_command_sends_deep_link_button(monkeypatch, db_session, fake_bale):
    monkeypatch.setenv("PUBLIC_BASE_URL", "https://app.example.ir")
    from energybot.settings import get_settings
    get_settings.cache_clear()

    # Pre-seed the user with a completed onboarding so /web isn't intercepted
    # by the first-contact check (which fires when OnboardingState is absent).
    from datetime import datetime
    from energybot.core.models import User, Profile, OnboardingState
    u = User(bale_user_id=88888)
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    db_session.add(OnboardingState(user_id=u.id, current_step="city", answers={}, completed_at=datetime.utcnow()))
    await db_session.commit()

    def session_factory():
        return db_session

    from energybot.bale_adapter.handler import handle_bale_update
    body = {
        "update_id": 9001,
        "message": {"message_id": 1, "from": {"id": 88888}, "chat": {"id": 88888}, "text": "/web"},
    }
    await handle_bale_update(body, session_factory=session_factory)

    assert len(fake_bale.sent) >= 1
    last = fake_bale.sent[-1]
    btn = last["reply_markup"]["inline_keyboard"][0][0]
    assert btn["url"].startswith("https://app.example.ir/app/auth?t=")
    tok = (await db_session.execute(select(WebLoginToken))).scalars().first()
    assert tok is not None
