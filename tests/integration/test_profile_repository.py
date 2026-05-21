import pytest
from sqlalchemy import select
from uuid import uuid4

from energybot.core.models import User, Profile, ProfileEvent
from energybot.profile.repository import ProfileRepository


async def _make_user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="علی")
    db_session.add(u)
    await db_session.flush()  # ensure u.id is populated before referencing in Profile
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_set_household_field_writes_event(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.set(u.id, "household.city", "تهران", source="wizard", reason="onboarding step")
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.household["city"] == "تهران"
    events = (await db_session.execute(select(ProfileEvent).where(ProfileEvent.user_id == u.id))).scalars().all()
    assert len(events) == 1
    assert events[0].field_path == "household.city"
    assert events[0].after == {"value": "تهران"}
    assert events[0].source == "wizard"


@pytest.mark.asyncio
async def test_append_goal(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.append(u.id, "goals", {"text": "کاهش قبض برق", "status": "active"}, source="agent_tool", reason="user said")
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.goals == [{"text": "کاهش قبض برق", "status": "active"}]


@pytest.mark.asyncio
async def test_completeness_score_updates(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.set(u.id, "household.city", "تهران", source="wizard", reason="")
    await repo.set(u.id, "household.home_type", "آپارتمان", source="wizard", reason="")
    await repo.set(u.id, "household.occupants", 3, source="wizard", reason="")
    p = await repo.get(u.id)
    assert p.completeness_score >= 30
