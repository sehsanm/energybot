from __future__ import annotations

from typing import Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import CityClimateZone, IncentiveParamSet
from energybot.core.normalize_fa import normalize_fa


class IncentiveRepository:
    def __init__(self, session_factory: Callable[[], AsyncSession]):
        self._sf = session_factory

    async def active_param_set(self, climate_zone: str, year: int | None = None) -> IncentiveParamSet | None:
        s = self._sf()
        q = select(IncentiveParamSet).where(
            IncentiveParamSet.climate_zone == climate_zone,
            IncentiveParamSet.is_active.is_(True),
        )
        if year is not None:
            q = q.where(IncentiveParamSet.effective_year == year)
        q = q.order_by(IncentiveParamSet.effective_year.desc())
        return (await s.execute(q)).scalars().first()

    async def resolve_city_zone(self, city: str) -> str | None:
        norm = normalize_fa(city)
        if not norm:
            return None
        s = self._sf()
        row = (await s.execute(
            select(CityClimateZone).where(
                CityClimateZone.city_name == norm,
                CityClimateZone.is_active.is_(True),
            )
        )).scalars().first()
        return row.climate_zone if row else None

    async def list_param_sets(self) -> list[IncentiveParamSet]:
        s = self._sf()
        return list((await s.execute(
            select(IncentiveParamSet).order_by(
                IncentiveParamSet.effective_year.desc(), IncentiveParamSet.climate_zone
            )
        )).scalars().all())

    async def list_city_zones(self) -> list[CityClimateZone]:
        s = self._sf()
        return list((await s.execute(
            select(CityClimateZone).order_by(CityClimateZone.city_name)
        )).scalars().all())
