from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, AuditLog, CityClimateZone, IncentiveParamSet
from energybot.core.normalize_fa import normalize_fa

router = APIRouter(prefix="/api/admin/incentives", tags=["admin-incentives"])


def _param_dict(p: IncentiveParamSet) -> dict[str, Any]:
    return {
        "id": str(p.id), "effective_year": p.effective_year, "climate_zone": p.climate_zone,
        "label": p.label, "params": p.params or {}, "is_active": p.is_active,
    }


def _city_dict(c: CityClimateZone) -> dict[str, Any]:
    return {
        "id": str(c.id), "city_name": c.city_name, "province": c.province,
        "climate_zone": c.climate_zone, "is_active": c.is_active,
    }


# ---------- param sets ----------

@router.get("/params")
async def list_params(_: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(IncentiveParamSet).order_by(
        IncentiveParamSet.effective_year.desc(), IncentiveParamSet.climate_zone))).scalars().all()
    return {"params": [_param_dict(p) for p in rows]}


@router.post("/params")
async def create_param(payload: dict, _: AdminUser = Depends(current_admin),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    p = IncentiveParamSet(
        effective_year=int(payload["effective_year"]),
        climate_zone=str(payload["climate_zone"]).strip(),
        label=payload.get("label"),
        params=payload.get("params", {}),
        is_active=bool(payload.get("is_active", False)),
    )
    s.add(p)
    await s.commit()
    return {"id": str(p.id)}


@router.put("/params/{param_id}")
async def update_param(param_id: UUID, payload: dict, admin: AdminUser = Depends(current_admin),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    p = (await s.execute(select(IncentiveParamSet).where(IncentiveParamSet.id == param_id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404)
    before = _param_dict(p)
    if "effective_year" in payload:
        p.effective_year = int(payload["effective_year"])
    if "climate_zone" in payload:
        p.climate_zone = str(payload["climate_zone"]).strip()
    if "label" in payload:
        p.label = payload["label"]
    if "params" in payload:
        p.params = payload["params"]
    if "is_active" in payload:
        p.is_active = bool(payload["is_active"])
    s.add(AuditLog(admin_user_id=admin.id, action="update_incentive_param_set",
                   entity_type="incentive_param_set", entity_id=str(param_id),
                   before=before, after=_param_dict(p)))
    await s.commit()
    return {"ok": True}


@router.delete("/params/{param_id}")
async def delete_param(param_id: UUID, admin: AdminUser = Depends(current_admin),
                       s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    p = (await s.execute(select(IncentiveParamSet).where(IncentiveParamSet.id == param_id))).scalar_one_or_none()
    if p is None:
        raise HTTPException(404)
    await s.delete(p)
    s.add(AuditLog(admin_user_id=admin.id, action="delete_incentive_param_set",
                   entity_type="incentive_param_set", entity_id=str(param_id), before=None, after=None))
    await s.commit()
    return {"ok": True}


# ---------- city zones ----------

@router.get("/cities")
async def list_cities(_: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(CityClimateZone).order_by(CityClimateZone.city_name))).scalars().all()
    return {"cities": [_city_dict(c) for c in rows]}


@router.post("/cities")
async def create_city(payload: dict, _: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    c = CityClimateZone(
        city_name=normalize_fa(str(payload["city_name"])),
        province=payload.get("province"),
        climate_zone=str(payload["climate_zone"]).strip(),
        is_active=bool(payload.get("is_active", True)),
    )
    s.add(c)
    await s.commit()
    return {"id": str(c.id)}


@router.put("/cities/{city_id}")
async def update_city(city_id: UUID, payload: dict, admin: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    c = (await s.execute(select(CityClimateZone).where(CityClimateZone.id == city_id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(404)
    before = _city_dict(c)
    if "city_name" in payload:
        c.city_name = normalize_fa(str(payload["city_name"]))
    if "province" in payload:
        c.province = payload["province"]
    if "climate_zone" in payload:
        c.climate_zone = str(payload["climate_zone"]).strip()
    if "is_active" in payload:
        c.is_active = bool(payload["is_active"])
    s.add(AuditLog(admin_user_id=admin.id, action="update_city_climate_zone",
                   entity_type="city_climate_zone", entity_id=str(city_id),
                   before=before, after=_city_dict(c)))
    await s.commit()
    return {"ok": True}


@router.delete("/cities/{city_id}")
async def delete_city(city_id: UUID, admin: AdminUser = Depends(current_admin),
                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    c = (await s.execute(select(CityClimateZone).where(CityClimateZone.id == city_id))).scalar_one_or_none()
    if c is None:
        raise HTTPException(404)
    await s.delete(c)
    s.add(AuditLog(admin_user_id=admin.id, action="delete_city_climate_zone",
                   entity_type="city_climate_zone", entity_id=str(city_id), before=None, after=None))
    await s.commit()
    return {"ok": True}
