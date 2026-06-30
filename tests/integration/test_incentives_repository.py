import pytest
from energybot.core.models import IncentiveParamSet, CityClimateZone
from energybot.incentives.repository import IncentiveRepository


def _repo(db_session):
    return IncentiveRepository(session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_active_param_set_returns_active_for_zone(db_session):
    db_session.add(IncentiveParamSet(effective_year=1403, climate_zone="normal",
                                     params={"v": 1}, is_active=False))
    db_session.add(IncentiveParamSet(effective_year=1404, climate_zone="normal",
                                     params={"v": 2}, is_active=True))
    await db_session.commit()
    ps = await _repo(db_session).active_param_set("normal")
    assert ps is not None
    assert ps.params["v"] == 2


@pytest.mark.asyncio
async def test_active_param_set_missing_zone_returns_none(db_session):
    ps = await _repo(db_session).active_param_set("hot")
    assert ps is None


@pytest.mark.asyncio
async def test_resolve_city_zone_normalizes(db_session):
    # stored normalized (normalize_fa lowercases + maps Arabic chars)
    db_session.add(CityClimateZone(city_name="تهران", climate_zone="normal", is_active=True))
    await db_session.commit()
    repo = _repo(db_session)
    assert await repo.resolve_city_zone("  تهران ") == "normal"
    assert await repo.resolve_city_zone("اهواز") is None


@pytest.mark.asyncio
async def test_resolve_city_zone_ignores_inactive(db_session):
    db_session.add(CityClimateZone(city_name="یزد", climate_zone="hot", is_active=False))
    await db_session.commit()
    assert await _repo(db_session).resolve_city_zone("یزد") is None
