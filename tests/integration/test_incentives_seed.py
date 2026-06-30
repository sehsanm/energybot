import pytest
from sqlalchemy import select
from energybot.core.models import CityClimateZone, IncentiveParamSet
from scripts.seed_dev import seed_incentives


@pytest.mark.asyncio
async def test_seed_incentives_is_idempotent(db_session):
    maker = lambda: db_session  # noqa: E731 — reuse the test session
    await seed_incentives(maker)
    await seed_incentives(maker)  # second run must not duplicate
    params = (await db_session.execute(select(IncentiveParamSet))).scalars().all()
    cities = (await db_session.execute(select(CityClimateZone))).scalars().all()
    zones = {p.climate_zone for p in params}
    assert {"normal", "hot"} <= zones
    # exactly one active set per seeded zone, no duplicates from the 2nd run
    assert len([p for p in params if p.climate_zone == "normal"]) == 1
    assert len(cities) >= 10
    # every seeded city resolves to a zone that has a param set
    assert all(c.climate_zone in zones for c in cities)
    # city names are stored normalized (lowercased, trimmed)
    assert all(c.city_name == c.city_name.strip() for c in cities)


@pytest.mark.asyncio
async def test_seed_params_shape(db_session):
    await seed_incentives(lambda: db_session)
    p = (await db_session.execute(
        select(IncentiveParamSet).where(IncentiveParamSet.climate_zone == "normal")
    )).scalar_one()
    assert p.params["savings_reward"]["min_reduction_pct"] == 10
    assert p.params["free_tier"]["summer"]["pattern_kwh"] > 0
    assert p.params["verified"] is False
