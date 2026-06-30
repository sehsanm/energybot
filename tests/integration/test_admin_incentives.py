import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import AdminUser, AuditLog, CityClimateZone, IncentiveParamSet
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
async def test_params_requires_auth(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/admin/incentives/params")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_create_and_list_param_set(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/incentives/params", headers=hdr, json={
            "effective_year": 1404, "climate_zone": "normal", "label": "عادی",
            "params": {"savings_reward": {"min_reduction_pct": 10}}, "is_active": True,
        })
        assert r.status_code == 200
        rid = r.json()["id"]
        lst = await c.get("/api/admin/incentives/params", headers=hdr)
    body = lst.json()
    assert any(p["id"] == rid and p["climate_zone"] == "normal" for p in body["params"])


@pytest.mark.asyncio
async def test_update_param_set_writes_audit(app, db_session):
    ps = IncentiveParamSet(effective_year=1404, climate_zone="hot", params={"v": 1}, is_active=False)
    db_session.add(ps)
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.put(f"/api/admin/incentives/params/{ps.id}", headers=hdr, json={
            "params": {"v": 2}, "is_active": True,
        })
    assert r.status_code == 200
    rows = (await db_session.execute(
        select(AuditLog).where(AuditLog.entity_id == str(ps.id))
    )).scalars().all()
    assert any(row.action == "update_incentive_param_set" for row in rows)


@pytest.mark.asyncio
async def test_create_city_normalizes_name(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/incentives/cities", headers=hdr, json={
            "city_name": "  تهران ", "province": "تهران", "climate_zone": "normal",
        })
    assert r.status_code == 200
    row = (await db_session.execute(select(CityClimateZone))).scalar_one()
    assert row.city_name == "تهران"  # trimmed + normalized


@pytest.mark.asyncio
async def test_delete_param_set(app, db_session):
    ps = IncentiveParamSet(effective_year=1404, climate_zone="normal", params={}, is_active=False)
    db_session.add(ps)
    await db_session.commit()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.delete(f"/api/admin/incentives/params/{ps.id}", headers=hdr)
    assert r.status_code == 200
    remaining = (await db_session.execute(select(IncentiveParamSet))).scalars().all()
    assert remaining == []


@pytest.mark.asyncio
async def test_create_duplicate_city_returns_409(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        payload = {"city_name": "تهران", "province": "تهران", "climate_zone": "normal"}
        r1 = await c.post("/api/admin/incentives/cities", headers=hdr, json=payload)
        assert r1.status_code == 200
        r2 = await c.post("/api/admin/incentives/cities", headers=hdr, json=payload)
        assert r2.status_code == 409


@pytest.mark.asyncio
async def test_create_duplicate_param_returns_409(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        payload = {"effective_year": 1404, "climate_zone": "warm", "params": {}}
        r1 = await c.post("/api/admin/incentives/params", headers=hdr, json=payload)
        assert r1.status_code == 200
        r2 = await c.post("/api/admin/incentives/params", headers=hdr, json=payload)
        assert r2.status_code == 409


@pytest.mark.asyncio
async def test_create_param_writes_audit(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post("/api/admin/incentives/params", headers=hdr, json={
            "effective_year": 1405, "climate_zone": "cold", "params": {}, "is_active": True,
        })
        assert r.status_code == 200
        new_id = r.json()["id"]
    rows = (await db_session.execute(
        select(AuditLog).where(AuditLog.entity_id == new_id)
    )).scalars().all()
    assert any(row.action == "create_incentive_param_set" for row in rows)


@pytest.mark.asyncio
async def test_delete_param_set_captures_before(app, db_session):
    ps = IncentiveParamSet(effective_year=1404, climate_zone="semi-arid", params={"k": 1}, is_active=True)
    db_session.add(ps)
    await db_session.commit()
    pid = str(ps.id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.delete(f"/api/admin/incentives/params/{ps.id}", headers=hdr)
    assert r.status_code == 200
    rows = (await db_session.execute(
        select(AuditLog).where(AuditLog.entity_id == pid)
    )).scalars().all()
    delete_log = next((row for row in rows if row.action == "delete_incentive_param_set"), None)
    assert delete_log is not None
    assert delete_log.before is not None
