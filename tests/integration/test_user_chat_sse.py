import os
import json
from uuid import uuid4
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User
from energybot.user_api.tokens import mint_login_token

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in dict(DATABASE_URL=TEST_DB, SESSION_SECRET="z" * 32, BALE_WEBHOOK_SECRET="x",
                     BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m",
                     WEB_CHAT_CHUNK_DELAY_MS="0", WEB_CHAT_CHUNK_CHARS="3").items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    import energybot.user_api.auth as _uauth
    _uauth._REDEEM_HITS.clear()
    from energybot.main import create_app
    return create_app()


async def _login(client, db_session, bale_user_id):
    u = User(bale_user_id=bale_user_id)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    r = await client.post("/api/app/auth/redeem", json={"t": raw})
    return u, r.headers["x-csrf"]


def _parse_sse(text):
    frames = []
    for block in text.strip().split("\n\n"):
        ev = data = None
        for line in block.splitlines():
            if line.startswith("event: "):
                ev = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        if ev:
            frames.append((ev, data))
    return frames


@pytest.mark.asyncio
async def test_chat_streams_status_media_chunks_done(app, db_session, monkeypatch):
    # Replace build_agent inside the chat module with a fake that buffers a media event
    # and returns a fixed reply, so framing is deterministic without an LLM.
    import energybot.user_api.chat as chat_mod

    def fake_build_agent(*, user_id, channel, session_factory):
        class _A:
            async def handle(self, text):
                from types import SimpleNamespace
                from energybot.agent.result import AgentResult
                await channel.send_media(SimpleNamespace(id=uuid4(), type="image"), "کپ")
                return AgentResult(text="سلام", suggestions=[])  # 4 chars → 2 chunks at chunk_chars=3
        return _A()

    monkeypatch.setattr(chat_mod, "build_agent", fake_build_agent)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 919191)
        r = await c.post("/api/app/chat", json={"text": "سلام"}, headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(r.text)
    kinds = [ev for ev, _ in frames]
    assert kinds[0] == "status"
    assert "media" in kinds
    assert kinds.count("chunk") == 2
    assert kinds[-1] == "done"
    # reassembled text equals the reply
    assert "".join(d["text"] for ev, d in frames if ev == "chunk") == "سلام"


@pytest.mark.asyncio
async def test_chat_emits_error_frame_on_agent_failure(app, db_session, monkeypatch):
    import energybot.user_api.chat as chat_mod

    def boom_build_agent(*, user_id, channel, session_factory):
        class _A:
            async def handle(self, text):
                raise RuntimeError("kaboom")
        return _A()

    monkeypatch.setattr(chat_mod, "build_agent", boom_build_agent)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 929292)
        r = await c.post("/api/app/chat", json={"text": "x"}, headers={"x-csrf": csrf})
    frames = _parse_sse(r.text)
    assert frames[0][0] == "status"
    assert frames[-1][0] == "error"
    assert "مشکل فنی" in frames[-1][1]["text"]


@pytest.mark.asyncio
async def test_chat_requires_csrf(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 939393)
        r = await c.post("/api/app/chat", json={"text": "x"})  # no x-csrf header
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_history_endpoint_returns_messages(app, db_session, monkeypatch):
    import energybot.user_api.chat as chat_mod

    def fake_build_agent(*, user_id, channel, session_factory):
        class _A:
            async def handle(self, text):
                from energybot.agent.result import AgentResult
                from energybot.chat.repository import ChatRepository
                repo = ChatRepository(session_factory=session_factory)
                sid = await repo.session_for(user_id)
                await repo.add_message(user_id, sid, role="user", content=text)
                await repo.add_message(user_id, sid, role="assistant", content="پاسخ")
                return AgentResult(text="پاسخ", suggestions=[])
        return _A()
    monkeypatch.setattr(chat_mod, "build_agent", fake_build_agent)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 949494)
        await c.post("/api/app/chat", json={"text": "سوال"}, headers={"x-csrf": csrf})
        r = await c.get("/api/app/chat/history")
    assert r.status_code == 200
    items = r.json()["messages"]
    assert [m["role"] for m in items] == ["user", "assistant"]
    assert items[0]["content"] == "سوال" and items[1]["content"] == "پاسخ"
