from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from energybot.core.models import DailyStats, Message, User
from energybot.jobs.daily_stats import recompute_daily_stats


@pytest.mark.asyncio
async def test_recompute_yesterday(db_session):
    u = User(bale_user_id=12345)
    db_session.add(u)
    await db_session.commit()
    yday = datetime.utcnow() - timedelta(days=1)
    sess_id = None
    from energybot.core.models import ChatSession
    sess = ChatSession(user_id=u.id, started_at=yday)
    db_session.add(sess)
    await db_session.commit()
    for i in range(3):
        m = Message(user_id=u.id, session_id=sess.id, role="user" if i % 2 == 0 else "assistant", content="x")
        m.created_at = yday
        db_session.add(m)
    await db_session.commit()
    await recompute_daily_stats(session_factory=lambda: db_session, for_date=yday.date())
    row = (await db_session.execute(select(DailyStats).where(DailyStats.date == yday.date()))).scalar_one()
    assert row.messages == 3
    assert row.dau == 1
