import pytest
from sqlalchemy import select
from energybot.core.models import IncentiveParamSet, CityClimateZone


@pytest.mark.asyncio
async def test_incentive_param_set_table_exists(db_session):
    rows = (await db_session.execute(select(IncentiveParamSet))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_city_climate_zone_table_exists(db_session):
    rows = (await db_session.execute(select(CityClimateZone))).scalars().all()
    assert rows == []


@pytest.mark.asyncio
async def test_param_set_roundtrip(db_session):
    ps = IncentiveParamSet(
        effective_year=1404, climate_zone="normal", label="عادی ۱۴۰۴",
        params={"savings_reward": {"min_reduction_pct": 10}}, is_active=True,
    )
    db_session.add(ps)
    await db_session.commit()
    got = (await db_session.execute(select(IncentiveParamSet))).scalar_one()
    assert got.climate_zone == "normal"
    assert got.params["savings_reward"]["min_reduction_pct"] == 10
    assert got.is_active is True
