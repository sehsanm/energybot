import os
import pytest
from httpx import ASGITransport, AsyncClient
from uuid import uuid4
from energybot.core.models import AdminUser, ChatSession, Message, Profile, User
from energybot.core.security import hash_password

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


async def _login(c: AsyncClient, db_session) -> dict:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    csrf = r.headers.get("x-csrf")
    return {"x-csrf": csrf}


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in {"DATABASE_URL": TEST_DB, "SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    import energybot.admin_api.auth as _auth
    _auth._LOGIN_HITS.clear()
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_list_users(app, db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="علی")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.get("/api/admin/users")
        body = r.json()
    assert r.status_code == 200
    assert any(item["display_name"] == "علی" for item in body["users"])


@pytest.mark.asyncio
async def test_get_user_returns_profile_and_sessions(app, db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.flush()
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.get(f"/api/admin/users/{u.id}")
        body = r.json()
    assert body["profile"]["household"]["city"] == "تهران"
    assert len(body["sessions"]) >= 1


@pytest.mark.asyncio
async def test_get_chat_transcript(app, db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.flush()
    await db_session.commit()
    db_session.add(Message(user_id=u.id, session_id=sess.id, role="user", content="سلام"))
    db_session.add(Message(user_id=u.id, session_id=sess.id, role="assistant", content="درود"))
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.get(f"/api/admin/chats/{sess.id}")
        body = r.json()
    assert len(body["messages"]) == 2
