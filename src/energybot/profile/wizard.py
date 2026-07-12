from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import OnboardingState
from energybot.profile.repository import ProfileRepository


@dataclass(slots=True)
class WizardStep:
    key: str
    prompt: str
    buttons: list[str] | None


@dataclass(slots=True)
class _StepDef:
    key: str
    prompt: str
    buttons: list[str] | None
    profile_path: str
    parse: Callable[[str], Any]


def _int(s: str) -> int:
    s = s.replace("۰", "0").replace("۱", "1").replace("۲", "2").replace("۳", "3").replace("۴", "4")
    s = s.replace("۵", "5").replace("۶", "6").replace("۷", "7").replace("۸", "8").replace("۹", "9").replace("+", "")
    return int(s.strip())


STEPS: list[_StepDef] = [
    _StepDef("city", "در چه شهری زندگی می‌کنی؟", None, "household.city", str.strip),
    _StepDef("home_type", "نوع مسکنت چیست؟", ["آپارتمان", "ویلایی", "مجتمع"], "household.home_type", str.strip),
    _StepDef("occupants", "چند نفر در خانه زندگی می‌کنید؟", ["1", "2", "3", "4", "5+"], "household.occupants", _int),
    _StepDef("area_m2", "متراژ تقریبی خانه؟", ["<60", "60-100", "100-150", "150-200", ">200"], "household.area_m2", str.strip),
    _StepDef("heating_type", "سیستم گرمایش؟", ["پکیج", "شوفاژ مرکزی", "بخاری گازی", "برقی"], "household.heating_type", str.strip),
    _StepDef("cooling_type", "سیستم سرمایش؟", ["کولر آبی", "اسپلیت", "کولر گازی پنجره‌ای", "مرکزی"], "household.cooling_type", str.strip),
    _StepDef("main_concern", "دغدغه اصلی؟", ["کاهش قبض برق", "کاهش قبض گاز", "یادگیری راه‌های صرفه‌جویی", "موارد دیگر"], "household.main_concern", str.strip),
]

_STEP_BY_KEY: dict[str, _StepDef] = {s.key: s for s in STEPS}
_STEP_BY_PATH: dict[str, _StepDef] = {s.profile_path: s for s in STEPS}


def household_field_schema() -> list[dict]:
    return [
        {"key": s.key, "label": s.prompt, "options": s.buttons, "path": s.profile_path}
        for s in STEPS
    ]


def normalize_household_value(path: str, value: str):
    step = _STEP_BY_PATH.get(path)
    if step is None:
        raise KeyError(path)
    if step.buttons is not None and str(value) not in step.buttons:
        raise ValueError(f"invalid option for {path}: {value!r}")
    return step.parse(str(value))


class WizardEngine:
    def __init__(self, *, session_factory: Callable[[], AsyncSession], profile_repo: ProfileRepository):
        self._session_factory = session_factory
        self._profile_repo = profile_repo

    async def start(self, user_id: UUID) -> WizardStep:
        s = self._session_factory()
        existing = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
        if existing is None:
            s.add(OnboardingState(user_id=user_id, current_step=STEPS[0].key, answers={}))
            await s.commit()
            cur = STEPS[0]
        else:
            cur = _STEP_BY_KEY[existing.current_step]
        return WizardStep(key=cur.key, prompt=cur.prompt, buttons=cur.buttons)

    async def current_step(self, user_id: UUID) -> WizardStep | None:
        s = self._session_factory()
        state = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
        if state is None or state.completed_at is not None:
            return None
        if state.current_step not in _STEP_BY_KEY:
            return None
        cur = _STEP_BY_KEY[state.current_step]
        return WizardStep(key=cur.key, prompt=cur.prompt, buttons=cur.buttons)

    async def abandon(self, user_id: UUID) -> None:
        s = self._session_factory()
        state = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
        if state and state.completed_at is None:
            state.completed_at = datetime.utcnow()
            await s.commit()

    async def answer(self, user_id: UUID, text_value: str) -> WizardStep | None:
        s = self._session_factory()
        state = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one()
        cur = _STEP_BY_KEY[state.current_step]
        parsed = cur.parse(text_value)
        await self._profile_repo.set(user_id, cur.profile_path, parsed, source="wizard", reason=f"wizard:{cur.key}")
        state.answers = {**state.answers, cur.key: parsed}
        idx = STEPS.index(cur)
        if idx + 1 < len(STEPS):
            state.current_step = STEPS[idx + 1].key
            await s.commit()
            nxt = STEPS[idx + 1]
            return WizardStep(key=nxt.key, prompt=nxt.prompt, buttons=nxt.buttons)
        from energybot.onboarding.flow import STEP_MOTIVATIONS
        state.current_step = STEP_MOTIVATIONS
        await s.commit()
        return None
