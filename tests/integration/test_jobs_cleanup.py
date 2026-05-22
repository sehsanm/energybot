from datetime import datetime, timedelta
import pytest
from sqlalchemy import select
from energybot.core.models import ProcessedUpdate, User, Profile
from energybot.jobs.cleanup import cleanup_processed_updates
from energybot.jobs.purge import hard_purge_soft_deleted


@pytest.mark.asyncio
async def test_processed_updates_older_than_24h_removed(db_session):
    old = ProcessedUpdate(update_id=1)
    old.created_at = datetime.utcnow() - timedelta(days=2)
    new = ProcessedUpdate(update_id=2)
    db_session.add_all([old, new])
    await db_session.commit()
    await cleanup_processed_updates(session_factory=lambda: db_session)
    rows = (await db_session.execute(select(ProcessedUpdate))).scalars().all()
    assert {r.update_id for r in rows} == {2}


@pytest.mark.asyncio
async def test_hard_purge_after_grace(db_session):
    u = User(bale_user_id=99988, display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    u.deleted_at = datetime.utcnow() - timedelta(days=40)
    await db_session.commit()
    await hard_purge_soft_deleted(session_factory=lambda: db_session, grace_days=30)
    rows = (await db_session.execute(select(User).where(User.id == u.id))).scalars().all()
    assert rows == []
