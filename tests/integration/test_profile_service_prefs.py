import pytest
from sqlalchemy import select
from energybot.core.models import User, Profile, ProfileEvent
from energybot.profile.repository import ProfileRepository


async def _make_user(session) -> User:
    u = User(bale_user_id=7001, display_name="t")
    session.add(u)
    await session.flush()
    session.add(Profile(user_id=u.id))
    await session.commit()
    return u


@pytest.mark.asyncio
async def test_set_service_prefs_persists_and_logs(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.set_service_prefs(u.id, ["daily_reminder", "weekly_summary"], source="onboarding", reason="onboarding:toolbox")
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.service_prefs == ["daily_reminder", "weekly_summary"]
    ev = (await db_session.execute(select(ProfileEvent).where(ProfileEvent.field_path == "service_prefs"))).scalars().all()
    assert ev and ev[-1].after == {"value": ["daily_reminder", "weekly_summary"]}
