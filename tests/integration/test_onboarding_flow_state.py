import pytest
from energybot.core.models import User, OnboardingState
from energybot.onboarding import flow


async def _state(session, current_step="city", completed=False):
    u = User(bale_user_id=8001, display_name="t")
    session.add(u)
    await session.flush()
    st = OnboardingState(user_id=u.id, current_step=current_step, answers={})
    if completed:
        from datetime import datetime
        st.completed_at = datetime.utcnow()
    session.add(st)
    await session.commit()
    return u


@pytest.mark.asyncio
async def test_active_phase_maps_steps(db_session):
    u = await _state(db_session, current_step="city")
    st = await flow.load_state(db_session, u.id)
    assert flow.active_phase(st) == flow.PHASE_PROFILE
    st.current_step = flow.STEP_FIRST_BILL
    await db_session.commit()
    st = await flow.load_state(db_session, u.id)
    assert flow.active_phase(st) == flow.PHASE_FIRST_BILL


@pytest.mark.asyncio
async def test_active_phase_none_when_completed(db_session):
    u = await _state(db_session, completed=True)
    st = await flow.load_state(db_session, u.id)
    assert flow.active_phase(st) is None


@pytest.mark.asyncio
async def test_draft_toggle_and_clear(db_session):
    u = await _state(db_session)
    sf = lambda: db_session
    assert await flow.toggle_draft(sf, u.id, "toolbox", "daily_reminder") == ["daily_reminder"]
    assert await flow.toggle_draft(sf, u.id, "toolbox", "weekly_summary") == ["daily_reminder", "weekly_summary"]
    assert await flow.toggle_draft(sf, u.id, "toolbox", "daily_reminder") == ["weekly_summary"]
    assert await flow.get_draft(sf, u.id, "toolbox") == ["weekly_summary"]
    await flow.clear_draft(sf, u.id, "toolbox")
    assert await flow.get_draft(sf, u.id, "toolbox") == []


@pytest.mark.asyncio
async def test_complete_sets_timestamp(db_session):
    u = await _state(db_session, current_step=flow.STEP_TOOLBOX)
    sf = lambda: db_session
    await flow.complete(sf, u.id)
    st = await flow.load_state(db_session, u.id)
    assert st.completed_at is not None
    assert flow.active_phase(st) is None
