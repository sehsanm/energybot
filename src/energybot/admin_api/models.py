from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.agent.model_configs import ModelConfigService
from energybot.core.db import get_session
from energybot.core.models import AdminUser, ModelConfig

router = APIRouter(prefix="/api/admin/models", tags=["admin-models"])


@router.get("")
async def list_models(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    rows = (await s.execute(select(ModelConfig).order_by(ModelConfig.call_type, ModelConfig.provider))).scalars().all()
    return {"models": [{"id": str(r.id), "call_type": r.call_type, "provider": r.provider, "model_name": r.model_name, "params": r.params, "is_active": r.is_active} for r in rows]}


@router.post("")
async def create_model(payload: dict, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    m = ModelConfig(call_type=payload["call_type"], provider=payload["provider"], model_name=payload["model_name"], params=payload.get("params", {}), is_active=False)
    s.add(m)
    await s.commit()
    return {"id": str(m.id)}


@router.post("/{config_id}/activate")
async def activate(config_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    svc = ModelConfigService(session_factory=lambda: s)
    await svc.activate(config_id)
    return {"ok": True}
