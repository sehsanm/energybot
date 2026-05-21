import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import ProcessedUpdate


@pytest.fixture
def app(monkeypatch):
    import os
    test_db = os.environ.get(
        "TEST_DATABASE_URL",
        "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
    )
    monkeypatch.setenv("DATABASE_URL", test_db)
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "TESTSECRET")
    monkeypatch.setenv("BALE_BOT_TOKEN", "x")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_webhook_rejects_bad_secret(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/bale/webhook/WRONG", json={"update_id": 1})
    assert r.status_code in (401, 403, 404)


@pytest.mark.asyncio
async def test_webhook_accepts_valid_secret_and_returns_200(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/bale/webhook/TESTSECRET", json={"update_id": 999, "message": {"message_id": 1, "from": {"id": 10}, "chat": {"id": 10}, "text": "سلام"}})
    assert r.status_code == 200


@pytest.mark.asyncio
async def test_webhook_idempotent_on_duplicate(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        body = {"update_id": 12345, "message": {"message_id": 1, "from": {"id": 11}, "chat": {"id": 11}, "text": "hi"}}
        await c.post("/bale/webhook/TESTSECRET", json=body)
        await c.post("/bale/webhook/TESTSECRET", json=body)
    rows = (await db_session.execute(select(ProcessedUpdate).where(ProcessedUpdate.update_id == 12345))).scalars().all()
    assert len(rows) == 1
