import io
import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import AdminUser
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
async def test_create_list_publish_delete_article(app, db_session, monkeypatch):
    # Stub the embedding router for publish to avoid real calls
    class StubRouter:
        async def embed(self, *, call_type, req):
            from energybot.providers.base import EmbeddingResponse
            return EmbeddingResponse(vectors=[[0.0] * 1536 for _ in req.inputs], tokens_in=0)

    monkeypatch.setattr("energybot.admin_api.kb.build_router_for_admin", lambda sf: StubRouter())

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/kb/articles", headers=hdr, json={"title": "تست", "body": "متن", "category": "gas", "tags": []})
        aid = r.json()["id"]
        assert r.status_code == 200
        r2 = await c.get("/api/admin/kb/articles")
        assert any(a["id"] == aid for a in r2.json()["articles"])
        r3 = await c.post(f"/api/admin/kb/articles/{aid}/publish", headers=hdr)
        assert r3.status_code == 200
        r4 = await c.delete(f"/api/admin/kb/articles/{aid}", headers=hdr)
        assert r4.status_code == 200
        r5 = await c.get("/api/admin/kb/articles")
        assert not any(a["id"] == aid for a in r5.json()["articles"])
