import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import User, Profile, ProfileEvent
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
    return u, r.headers["x-csrf"]


@pytest.mark.asyncio
async def test_get_profile_includes_schema(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 701701)
        r = await c.get("/api/app/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["completeness_score"] == 0
    assert [f["key"] for f in body["fields"]][0] == "city"


@pytest.mark.asyncio
async def test_patch_household_records_web_event(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 702702)
        r = await c.patch("/api/app/profile", json={"path": "household.home_type", "value": "ویلایی"},
                          headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.json()["household"]["home_type"] == "ویلایی"
    ev = (await db_session.execute(select(ProfileEvent).where(ProfileEvent.user_id == u.id))).scalars().all()
    assert any(e.source == "web" and e.field_path == "household.home_type" for e in ev)


@pytest.mark.asyncio
async def test_patch_invalid_option_422(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 703703)
        r = await c.patch("/api/app/profile", json={"path": "household.home_type", "value": "قصر"},
                          headers={"x-csrf": csrf})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_goals_add_and_remove(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 704704)
        r1 = await c.post("/api/app/profile/goals", json={"text": "کاهش مصرف"}, headers={"x-csrf": csrf})
        assert r1.json()["goals"] == ["کاهش مصرف"]
        r2 = await c.delete("/api/app/profile/goals/0", headers={"x-csrf": csrf})
    assert r2.status_code == 200
    assert r2.json()["goals"] == []


@pytest.mark.asyncio
async def test_object_goals_and_commitments_serialized_as_text(app, db_session):
    # Goals/commitments can be objects (bot agent + bill-suggestion targets) or
    # legacy strings (web-added). The web API contract is string[], so the
    # endpoint must flatten every item to its display text and never leak an
    # object (which crashes the React profile page).
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 706706)
        p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
        p.goals = [
            {"id": "g1", "text": "کاهش ۱۰٪ مصرف اوج", "status": "active",
             "source": "bill_suggestion", "metric": "peak_kwh", "baseline": 120,
             "target_value": 108, "target_date": "1405/04/31"},
            "هدف رشته‌ای قدیمی",
        ]
        p.commitments = [{"id": "c1", "text": "خاموش‌کردن لامپ‌ها", "target_date": None, "status": "open"}]
        await db_session.commit()
        r = await c.get("/api/app/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["goals"] == ["کاهش ۱۰٪ مصرف اوج", "هدف رشته‌ای قدیمی"]
    assert body["commitments"] == ["خاموش‌کردن لامپ‌ها"]
    assert all(isinstance(x, str) for x in body["goals"] + body["commitments"])


@pytest.mark.asyncio
async def test_bad_section_404(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 705705)
        r = await c.post("/api/app/profile/behaviour", json={"text": "x"}, headers={"x-csrf": csrf})
    assert r.status_code == 404
