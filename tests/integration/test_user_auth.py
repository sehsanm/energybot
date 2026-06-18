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
