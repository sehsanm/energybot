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
