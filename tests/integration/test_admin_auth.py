import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import AdminUser
from energybot.core.security import hash_password

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.fixture
async def app(monkeypatch, db_session):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "x")
    monkeypatch.setenv("BALE_BOT_TOKEN", "t")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_login_sets_session_cookie(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    assert r.status_code == 200
    assert "energybot_admin" in r.cookies


@pytest.mark.asyncio
async def test_login_wrong_password_rejected(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "wrong"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_session(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/admin/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_with_session(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
        r = await c.get("/api/admin/me")
    assert r.status_code == 200
    assert r.json()["email"] == "a@b.c"


@pytest.mark.asyncio
async def test_login_rate_limited_after_burst(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        for _ in range(6):
            await c.post("/api/admin/login", json={"email": "a@b.c", "password": "wrong"})
        r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "wrong"})
    assert r.status_code == 429
