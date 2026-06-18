import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, ChatSession
from energybot.chat.repository import ChatRepository
from energybot.user_api.tokens import mint_login_token

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in dict(DATABASE_URL=TEST_DB, SESSION_SECRET="z" * 32, BALE_WEBHOOK_SECRET="x",
                     BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m").items():
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


async def _seed_session(db_session, user_id):
    sess = ChatSession(user_id=user_id)
    db_session.add(sess)
    await db_session.flush()
    repo = ChatRepository(session_factory=lambda: db_session)
    await repo.add_message(user_id, sess.id, role="user", content="سوال اول")
    await repo.add_message(user_id, sess.id, role="assistant", content="پاسخ اول")
    await repo.add_message(user_id, sess.id, role="tool", content="{}", tool_name="search_kb")
    return sess


@pytest.mark.asyncio
async def test_list_sessions_shape(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 801801)
        await _seed_session(db_session, u.id)
        r = await c.get("/api/app/chat/sessions")
    assert r.status_code == 200
    sessions = r.json()["sessions"]
    assert sessions[0]["message_count"] == 2  # tool row excluded
    assert sessions[0]["snippet"] == "سوال اول"


@pytest.mark.asyncio
async def test_session_messages_excludes_tool_rows(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 802802)
        sess = await _seed_session(db_session, u.id)
        r = await c.get(f"/api/app/chat/sessions/{sess.id}")
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]


@pytest.mark.asyncio
async def test_session_not_owned_404(app, db_session):
    other = User(bale_user_id=999000)
    db_session.add(other)
    await db_session.flush()
    sess = await _seed_session(db_session, other.id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 803803)
        r = await c.get(f"/api/app/chat/sessions/{sess.id}")
    assert r.status_code == 404
