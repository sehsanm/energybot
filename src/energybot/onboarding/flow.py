from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import OnboardingState

PHASE_PROFILE = "profile"
PHASE_MOTIVATIONS = "motivations"
PHASE_FIRST_BILL = "first_bill"
PHASE_TOOLBOX = "toolbox"

STEP_MOTIVATIONS = "__motivations__"
STEP_FIRST_BILL = "__first_bill__"
STEP_TOOLBOX = "__toolbox__"

_SENTINEL_TO_PHASE = {
    STEP_MOTIVATIONS: PHASE_MOTIVATIONS,
    STEP_FIRST_BILL: PHASE_FIRST_BILL,
    STEP_TOOLBOX: PHASE_TOOLBOX,
}


async def load_state(session: AsyncSession, user_id: UUID) -> OnboardingState | None:
    return (await session.execute(
        select(OnboardingState).where(OnboardingState.user_id == user_id)
    )).scalar_one_or_none()


def active_phase(state: OnboardingState | None) -> str | None:
    if state is None or state.completed_at is not None:
        return None
    return _SENTINEL_TO_PHASE.get(state.current_step, PHASE_PROFILE)


async def _get(session: AsyncSession, user_id: UUID) -> OnboardingState:
    return (await session.execute(
        select(OnboardingState).where(OnboardingState.user_id == user_id)
    )).scalar_one()


async def set_step(session_factory, user_id: UUID, step: str) -> None:
    s = session_factory()
    st = await _get(s, user_id)
    st.current_step = step
    await s.commit()


async def complete(session_factory, user_id: UUID) -> None:
    s = session_factory()
    st = await _get(s, user_id)
    if st.completed_at is None:
        st.completed_at = datetime.utcnow()
        await s.commit()


def _draft_key(field: str) -> str:
    return f"{field}_draft"


async def get_draft(session_factory, user_id: UUID, field: str) -> list[str]:
    s = session_factory()
    st = await _get(s, user_id)
    return list(st.answers.get(_draft_key(field), []))


async def seed_draft(session_factory, user_id: UUID, field: str, keys) -> None:
    s = session_factory()
    st = await _get(s, user_id)
    st.answers = {**st.answers, _draft_key(field): list(keys)}
    await s.commit()


async def toggle_draft(session_factory, user_id: UUID, field: str, key: str) -> list[str]:
    s = session_factory()
    st = await _get(s, user_id)
    cur = list(st.answers.get(_draft_key(field), []))
    if key in cur:
        cur.remove(key)
    else:
        cur.append(key)
    st.answers = {**st.answers, _draft_key(field): cur}
    await s.commit()
    return cur


async def clear_draft(session_factory, user_id: UUID, field: str) -> None:
    s = session_factory()
    st = await _get(s, user_id)
    a = dict(st.answers)
    a.pop(_draft_key(field), None)
    st.answers = a
    await s.commit()
