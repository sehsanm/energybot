import os
from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from energybot.core.models import User, UserSession, WebLoginToken

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.mark.asyncio
async def test_web_auth_tables_roundtrip(db_session):
    u = User(bale_user_id=11111, display_name="آرش")
    db_session.add(u)
    await db_session.flush()
    db_session.add(WebLoginToken(token_hash="h1", user_id=u.id, expires_at=datetime.utcnow() + timedelta(minutes=5)))
    db_session.add(UserSession(id="s1", user_id=u.id, expires_at=datetime.utcnow() + timedelta(days=30)))
    await db_session.commit()
    tok = (await db_session.execute(select(WebLoginToken).where(WebLoginToken.token_hash == "h1"))).scalar_one()
    sess = (await db_session.execute(select(UserSession).where(UserSession.id == "s1"))).scalar_one()
    assert tok.user_id == u.id
    assert sess.user_id == u.id


from energybot.user_api.tokens import mint_login_token, redeem_login_token


@pytest.mark.asyncio
async def test_mint_then_redeem_returns_user_id(db_session):
    u = User(bale_user_id=22222)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    assert isinstance(raw, str) and len(raw) > 20
    got = await redeem_login_token(db_session, raw)
    assert got == u.id


@pytest.mark.asyncio
async def test_redeem_is_single_use(db_session):
    u = User(bale_user_id=33333)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    assert await redeem_login_token(db_session, raw) == u.id
    assert await redeem_login_token(db_session, raw) is None


@pytest.mark.asyncio
async def test_redeem_expired_returns_none(db_session):
    u = User(bale_user_id=44444)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=-1)  # already expired
    assert await redeem_login_token(db_session, raw) is None


@pytest.mark.asyncio
async def test_redeem_unknown_token_returns_none(db_session):
    assert await redeem_login_token(db_session, "not-a-real-token") is None


from httpx import ASGITransport, AsyncClient


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
    import energybot.user_api.auth as _uauth
    _uauth._REDEEM_HITS.clear()
    from energybot.main import create_app
    return create_app()


async def _mint_for(db_session, bale_user_id: int) -> str:
    u = User(bale_user_id=bale_user_id)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    return raw


@pytest.mark.asyncio
async def test_redeem_sets_session_cookie(app, db_session):
    raw = await _mint_for(db_session, 55555)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/app/auth/redeem", json={"t": raw})
    assert r.status_code == 200
    assert "energybot_user" in r.cookies
    assert r.json()["user"]["id"]


@pytest.mark.asyncio
async def test_redeem_bad_token_401(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.post("/api/app/auth/redeem", json={"t": "nope"})
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_requires_session(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_me_returns_user_after_redeem(app, db_session):
    raw = await _mint_for(db_session, 66666)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/api/app/auth/redeem", json={"t": raw})
        r = await c.get("/api/app/me")
    assert r.status_code == 200
    assert r.json()["language"] == "fa"


@pytest.mark.asyncio
async def test_blocked_user_rejected(app, db_session):
    from sqlalchemy import update
    raw = await _mint_for(db_session, 77777)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r_redeem = await c.post("/api/app/auth/redeem", json={"t": raw})
        assert r_redeem.status_code == 200, "redeem must succeed before blocking"
        # Now block the user in the DB so current_user sees it
        from energybot.core.models import User as U
        await db_session.execute(update(U).where(U.bale_user_id == 77777).values(is_blocked=True))
        await db_session.commit()
        r = await c.get("/api/app/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_soft_deleted_user_rejected(app, db_session):
    from sqlalchemy import update
    raw = await _mint_for(db_session, 88888)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r_redeem = await c.post("/api/app/auth/redeem", json={"t": raw})
        assert r_redeem.status_code == 200, "redeem must succeed before soft-deleting"
        # Soft-delete the user in the DB so current_user sees deleted_at is not None
        from energybot.core.models import User as U
        await db_session.execute(
            update(U).where(U.bale_user_id == 88888).values(deleted_at=datetime.utcnow())
        )
        await db_session.commit()
        r = await c.get("/api/app/me")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_redeem_rate_limited(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        for _ in range(10):
            await c.post("/api/app/auth/redeem", json={"t": "nope"})
        r = await c.post("/api/app/auth/redeem", json={"t": "nope"})
    assert r.status_code == 429
