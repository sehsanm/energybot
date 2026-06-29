import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, Profile
from energybot.memory.repository import MemoryRepository
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
    db_session.add(Profile(user_id=u.id))
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    r = await client.post("/api/app/auth/redeem", json={"t": raw})
    return u, r.headers["x-csrf"]


@pytest.mark.asyncio
async def test_get_memory_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/memory")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_memory_returns_active_grouped(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 811811)
        repo = MemoryRepository(session_factory=lambda: db_session)
        await repo.add(u.id, "اتاق خنک", "preference")
        m = await repo.add(u.id, "حذف‌شده", "misc")
        await repo.remove(u.id, m.id)  # soft-deleted, must not appear
        r = await c.get("/api/app/memory")
    assert r.status_code == 200
    body = r.json()
    cats = {c["key"]: c for c in body["categories"]}
    assert "preference" in cats
    assert cats["preference"]["label"] == "ترجیحات"
    assert cats["preference"]["items"][0]["text"] == "اتاق خنک"
    # soft-deleted item's category not present
    assert "misc" not in cats
