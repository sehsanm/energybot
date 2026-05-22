from collections.abc import Callable
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import Profile, ProfileEvent


REQUIRED_HOUSEHOLD_FIELDS = {"city", "home_type", "occupants", "area_m2", "heating_type", "cooling_type", "main_concern"}


def _split_path(path: str) -> tuple[str, list[str]]:
    parts = path.split(".")
    if len(parts) < 2:
        raise ValueError(f"path must be section.field[.sub]: {path!r}")
    return parts[0], parts[1:]


def _get_in(d: dict, keys: list[str]) -> Any:
    cur: Any = d
    for k in keys:
        if not isinstance(cur, dict):
            return None
        cur = cur.get(k)
    return cur


def _set_in(d: dict, keys: list[str], value: Any) -> dict:
    cur = d
    for k in keys[:-1]:
        if k not in cur or not isinstance(cur[k], dict):
            cur[k] = {}
        cur = cur[k]
    cur[keys[-1]] = value
    return d


def _compute_completeness(p: Profile) -> int:
    filled = sum(1 for k in REQUIRED_HOUSEHOLD_FIELDS if p.household.get(k))
    base = int(100 * filled / len(REQUIRED_HOUSEHOLD_FIELDS))
    bonus_goals = 10 if p.goals else 0
    bonus_behaviour = min(10, len(p.behaviour) * 2)
    return min(100, base + bonus_goals + bonus_behaviour)


class ProfileRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def get(self, user_id: UUID) -> Profile:
        s = self._session_factory()
        return (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()

    async def set(self, user_id: UUID, path: str, value: Any, *, source: str, reason: str, source_message_id: int | None = None) -> None:
        s = self._session_factory()
        p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()
        section, keys = _split_path(path)
        container = dict(getattr(p, section))
        before = _get_in(container, keys)
        _set_in(container, keys, value)
        setattr(p, section, container)
        p.completeness_score = _compute_completeness(p)
        s.add(ProfileEvent(
            user_id=user_id, field_path=path,
            before={"value": before} if before is not None else None,
            after={"value": value},
            source=source, source_message_id=source_message_id, reason=reason,
        ))
        await s.commit()

    async def append(self, user_id: UUID, section: str, item: Any, *, source: str, reason: str, source_message_id: int | None = None) -> None:
        if section not in ("goals", "commitments"):
            raise ValueError(f"append only supports goals|commitments, got {section!r}")
        s = self._session_factory()
        p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()
        arr = list(getattr(p, section))
        arr.append(item)
        setattr(p, section, arr)
        p.completeness_score = _compute_completeness(p)
        s.add(ProfileEvent(
            user_id=user_id, field_path=f"{section}[+]",
            before=None, after={"item": item},
            source=source, source_message_id=source_message_id, reason=reason,
        ))
        await s.commit()
