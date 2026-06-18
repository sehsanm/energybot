import os
import pytest
from energybot.core.models import User, UtilitySubscription, Bill
from energybot.billing.repository import BillingRepository
from httpx import ASGITransport, AsyncClient
from energybot.user_api.tokens import mint_login_token
from energybot.billing.service import CaptureResult

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.mark.asyncio
async def test_build_billing_service_importable_and_constructs(monkeypatch):
    for k, v in dict(DATABASE_URL=TEST_DB, SESSION_SECRET="z" * 32, BALE_WEBHOOK_SECRET="x",
                     BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m").items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    from energybot.billing.factory import build_billing_service
    from energybot.billing.service import BillingService
    svc = build_billing_service(lambda: None)
    assert isinstance(svc, BillingService)


@pytest.mark.asyncio
async def test_list_subscriptions_excludes_deleted_newest_first(db_session):
    from datetime import datetime
    u = User(bale_user_id=601601)
    db_session.add(u)
    await db_session.flush()
    db_session.add(UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="111", label="A"))
    db_session.add(UtilitySubscription(user_id=u.id, utility_type="gas", bill_id="222", label="B"))
    dead = UtilitySubscription(user_id=u.id, utility_type="gas", bill_id="333", label="C", deleted_at=datetime.utcnow())
    db_session.add(dead)
    await db_session.commit()
    repo = BillingRepository(session_factory=lambda: db_session)
    subs = await repo.list_subscriptions(u.id)
    labels = [x.label for x in subs]
    assert "C" not in labels
    assert set(labels) == {"A", "B"}
    assert subs[0].label == "B"  # newest first (created after A)


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


@pytest.mark.asyncio
async def test_get_bills_shape(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 602602)
        db_session.add(UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="111", label="خانه"))
        await db_session.commit()
        r = await c.get("/api/app/bills")
    assert r.status_code == 200
    body = r.json()
    assert body["subscriptions"][0]["label"] == "خانه"
    assert "bills" in body


@pytest.mark.asyncio
async def test_inquire_uses_billing_service(app, db_session, monkeypatch):
    import energybot.user_api.bills as bills_mod

    class _FakeSvc:
        async def handle_input(self, user_id, *, text=None, image_bytes=None):
            return CaptureResult(ok=True, summary="📄 قبض برق", pay_callback="pay:abc",
                                 bill_db_id="abc-123", error=None)
    monkeypatch.setattr(bills_mod, "build_billing_service", lambda sf: _FakeSvc())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 603603)
        r = await c.post("/api/app/bills/inquire", json={"bill_id": "12345"}, headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "summary": "📄 قبض برق", "bill_db_id": "abc-123", "error": None}


@pytest.mark.asyncio
async def test_pay_passes_bale_user_id_as_chat_id(app, db_session, monkeypatch):
    import energybot.user_api.bills as bills_mod
    seen = {}

    class _FakeSvc:
        async def start_payment(self, user_id, chat_id, bill_db_id):
            seen["chat_id"] = chat_id
            return "https://gw.example/pay/xyz"
    monkeypatch.setattr(bills_mod, "build_billing_service", lambda sf: _FakeSvc())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 604604)
        # Create a real bill owned by user A so the ownership check passes
        sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="604", label="خانه")
        db_session.add(sub)
        await db_session.flush()
        bill = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity", amount=50000, term="1402")
        db_session.add(bill)
        await db_session.commit()
        r = await c.post(f"/api/app/bills/{bill.id}/pay", headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.json()["url"] == "https://gw.example/pay/xyz"
    assert seen["chat_id"] == 604604  # == bale_user_id


@pytest.mark.asyncio
async def test_pay_rejects_other_users_bill(app, db_session):
    """IDOR: user A cannot pay user B's bill — ownership check fires before payment provider."""
    # Create user B with a real bill in the DB
    user_b = User(bale_user_id=605605)
    db_session.add(user_b)
    await db_session.flush()
    sub_b = UtilitySubscription(user_id=user_b.id, utility_type="electricity", bill_id="999", label="B's home")
    db_session.add(sub_b)
    await db_session.flush()
    bill_b = Bill(
        user_id=user_b.id,
        subscription_id=sub_b.id,
        utility_type="electricity",
        amount=100000,
        term="1402",
    )
    db_session.add(bill_b)
    await db_session.commit()

    # Log in as user A and try to pay user B's bill
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        _user_a, csrf = await _login(c, db_session, 606606)
        r = await c.post(f"/api/app/bills/{bill_b.id}/pay", headers={"x-csrf": csrf})
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_bills_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/bills")
    assert r.status_code == 401
