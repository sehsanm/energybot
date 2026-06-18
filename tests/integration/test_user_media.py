import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, KBArticle, KBAttachment
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
    await client.post("/api/app/auth/redeem", json={"t": raw})
    return u


async def _attachment(db_session, tmp_path):
    art = KBArticle(title="t", category="electricity")
    db_session.add(art)
    await db_session.flush()
    f = tmp_path / "pic.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\nDATA")
    att = KBAttachment(article_id=art.id, type="image", mime_type="image/png",
                       file_size_bytes=12, storage_path=str(f))
    db_session.add(att)
    await db_session.commit()
    return att


@pytest.mark.asyncio
async def test_media_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/media/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_media_serves_file(app, db_session, tmp_path):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 717171)
        att = await _attachment(db_session, tmp_path)
        r = await c.get(f"/api/app/media/{att.id}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content == b"\x89PNG\r\n\x1a\nDATA"


@pytest.mark.asyncio
async def test_media_unknown_404(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 818181)
        r = await c.get("/api/app/media/11111111-1111-1111-1111-111111111111")
    assert r.status_code == 404
