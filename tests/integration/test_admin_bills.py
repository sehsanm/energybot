import os
import pytest
from uuid import uuid4
from httpx import ASGITransport, AsyncClient
from energybot.core.models import AdminUser, User, UtilitySubscription, Bill
from energybot.core.security import hash_password

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


async def _login(c, db_session) -> dict:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    return {"x-csrf": r.headers.get("x-csrf")}


async def _user_with_bill(db_session, *, suggestions=None) -> tuple[User, Bill]:
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
             amount=2_000_000, term="1405/2", details={"tariff": "خانگی"}, suggestions=suggestions)
    db_session.add(b)
    await db_session.commit()
    return u, b


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in {"DATABASE_URL": TEST_DB, "SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x",
                  "BALE_BOT_TOKEN": "t", "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
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
async def test_list_bills_requires_auth(app, db_session):
    u, _ = await _user_with_bill(db_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get(f"/api/admin/users/{u.id}/bills")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_bills_returns_shape(app, db_session):
    u, b = await _user_with_bill(db_session, suggestions={"intro": "hi", "tips": [], "targets": []})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session)
        r = await c.get(f"/api/admin/users/{u.id}/bills")
    body = r.json()
    assert r.status_code == 200
    assert body["bills"][0]["id"] == str(b.id)
    assert body["bills"][0]["details"]["tariff"] == "خانگی"
    assert body["bills"][0]["suggestions"]["intro"] == "hi"


@pytest.mark.asyncio
async def test_regenerate_returns_payload(app, db_session, monkeypatch):
    u, b = await _user_with_bill(db_session)
    async def fake_regen(**kw):
        return {"intro": "تازه", "tips": [], "targets": []}
    monkeypatch.setattr("energybot.billing.suggestions.regenerate_suggestions", fake_regen)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/regenerate", headers=hdr)
    assert r.status_code == 200
    assert r.json()["suggestions"]["intro"] == "تازه"


@pytest.mark.asyncio
async def test_regenerate_rejects_foreign_bill(app, db_session, monkeypatch):
    u1, _ = await _user_with_bill(db_session)
    u2, b2 = await _user_with_bill(db_session)
    async def fake_regen(**kw):
        return {"intro": "x", "tips": [], "targets": []}
    monkeypatch.setattr("energybot.billing.suggestions.regenerate_suggestions", fake_regen)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        # bill b2 belongs to u2, not u1 -> 404
        r = await c.post(f"/api/admin/users/{u1.id}/bills/{b2.id}/suggestions/regenerate", headers=hdr)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_send_ok_and_409(app, db_session, monkeypatch):
    u, b = await _user_with_bill(db_session)
    state = {"ok": True}
    async def fake_send(**kw):
        return state["ok"]
    monkeypatch.setattr("energybot.billing.suggestions.send_suggestions", fake_send)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r1 = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/send", headers=hdr)
        state["ok"] = False
        r2 = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/send", headers=hdr)
    assert r1.status_code == 200 and r1.json()["ok"] is True
    assert r2.status_code == 409


@pytest.mark.asyncio
async def test_regenerate_502_on_generation_failure(app, db_session, monkeypatch):
    u, b = await _user_with_bill(db_session)
    async def fake_regen(**kw):
        return None
    monkeypatch.setattr("energybot.billing.suggestions.regenerate_suggestions", fake_regen)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/regenerate", headers=hdr)
    assert r.status_code == 502


@pytest.mark.asyncio
async def test_send_writes_audit_log(app, db_session, monkeypatch):
    from sqlalchemy import select
    from energybot.core.models import AuditLog
    u, b = await _user_with_bill(db_session)
    async def fake_send(**kw):
        return True
    monkeypatch.setattr("energybot.billing.suggestions.send_suggestions", fake_send)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/send", headers=hdr)
    assert r.status_code == 200
    rows = (await db_session.execute(select(AuditLog).where(AuditLog.entity_id == str(b.id)))).scalars().all()
    assert any(row.action == "send_bill_suggestions" for row in rows)
