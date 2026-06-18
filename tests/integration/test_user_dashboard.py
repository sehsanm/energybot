import os
from datetime import datetime, timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, Profile, UtilitySubscription, Bill
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
    return u


@pytest.mark.asyncio
async def test_dashboard_aggregates_profile_and_bills(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u = await _login(c, db_session, 1001001)
        sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="111")
        db_session.add(sub)
        await db_session.flush()
        now = datetime.utcnow()
        # older bill, with consumption
        db_session.add(Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                            amount=120000, term="1401", consumption=210, inquired_at=now - timedelta(days=2)))
        # newest bill, no consumption value
        db_session.add(Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                            amount=150000, term="1402", consumption=None, inquired_at=now))
        # middle bill, with consumption
        db_session.add(Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                            amount=130000, term="1402-spring", consumption=180, inquired_at=now - timedelta(days=1)))
        await db_session.commit()
        r = await c.get("/api/app/dashboard")
    assert r.status_code == 200
    body = r.json()
    assert body["completeness_score"] == 0
    assert body["latest_bill"]["term"] == "1402"          # newest by inquired_at
    assert body["latest_bill"]["amount"] == 150000
    # trend: only bills with consumption, oldest-first
    assert [t["consumption"] for t in body["trend"]] == [210, 180]


@pytest.mark.asyncio
async def test_dashboard_empty_when_no_bills(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 1002002)
        r = await c.get("/api/app/dashboard")
    assert r.status_code == 200
    body = r.json()
    assert body["latest_bill"] is None
    assert body["trend"] == []


@pytest.mark.asyncio
async def test_dashboard_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/dashboard")
    assert r.status_code == 401
