import pytest
from sqlalchemy import select
from uuid import uuid4
from energybot.core.models import User, Profile, OnboardingState
from energybot.profile.repository import ProfileRepository
from energybot.profile.wizard import WizardEngine


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()  # ensure u.id is populated before referencing in Profile
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_first_step_is_city(db_session):
    u = await _user(db_session)
    eng = WizardEngine(session_factory=lambda: db_session, profile_repo=ProfileRepository(session_factory=lambda: db_session))
    step = await eng.start(u.id)
    assert step.key == "city"
    assert "شهر" in step.prompt


@pytest.mark.asyncio
async def test_answer_advances_step_and_persists(db_session):
    u = await _user(db_session)
    eng = WizardEngine(session_factory=lambda: db_session, profile_repo=ProfileRepository(session_factory=lambda: db_session))
    await eng.start(u.id)
    next_step = await eng.answer(u.id, "تهران")
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.answers["city"] == "تهران"
    assert next_step.key == "home_type"


@pytest.mark.asyncio
async def test_full_wizard_completes_and_writes_profile(db_session):
    u = await _user(db_session)
    eng = WizardEngine(session_factory=lambda: db_session, profile_repo=ProfileRepository(session_factory=lambda: db_session))
    await eng.start(u.id)
    answers = ["تهران", "آپارتمان", "3", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"]
    last = None
    for a in answers:
        last = await eng.answer(u.id, a)
    assert last is None
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.household["city"] == "تهران"
    assert p.household["home_type"] == "آپارتمان"
    assert p.household["occupants"] == 3
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    # Wizard hands off to the motivations phase instead of completing onboarding.
    from energybot.onboarding.flow import STEP_MOTIVATIONS
    assert state.completed_at is None
    assert state.current_step == STEP_MOTIVATIONS
