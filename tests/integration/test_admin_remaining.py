import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import AdminUser, ModelConfig, PromptTemplate
from energybot.core.security import hash_password

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.fixture
async def app(monkeypatch):
    for k, v in {"DATABASE_URL": TEST_DB, "SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    from energybot.main import create_app
    return create_app()


async def _login(c, db_session) -> dict:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    return {"x-csrf": r.headers.get("x-csrf")}


@pytest.mark.asyncio
async def test_create_and_activate_prompt(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/prompts", headers=hdr, json={"key": "system_prompt", "name": "n", "body": "تست {{x}}"})
        pid = r.json()["id"]
        r2 = await c.post(f"/api/admin/prompts/{pid}/activate", headers=hdr)
        assert r2.status_code == 200
        r3 = await c.get("/api/admin/prompts?key=system_prompt")
        active = [p for p in r3.json()["prompts"] if p["status"] == "active"]
        assert len(active) == 1


@pytest.mark.asyncio
async def test_dashboard_stats_returns_zero_state(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.get("/api/admin/stats/dashboard")
    body = r.json()
    assert "dau" in body and "messages_today" in body


@pytest.mark.asyncio
async def test_audit_log_endpoint(app, db_session):
    from energybot.core.models import AuditLog
    db_session.add(AuditLog(action="x", entity_type="t", entity_id="1", before=None, after=None))
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.get("/api/admin/audit-log")
    assert any(item["action"] == "x" for item in r.json()["entries"])
