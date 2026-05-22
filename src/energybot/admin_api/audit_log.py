from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, AuditLog

router = APIRouter(prefix="/api/admin/audit-log", tags=["admin-audit"])


@router.get("")
async def list_audit(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    rows = (await s.execute(select(AuditLog).order_by(AuditLog.id.desc()).limit(500))).scalars().all()
    return {"entries": [{"id": r.id, "admin_user_id": str(r.admin_user_id) if r.admin_user_id else None,
                          "action": r.action, "entity_type": r.entity_type, "entity_id": r.entity_id,
                          "before": r.before, "after": r.after, "created_at": r.created_at.isoformat()} for r in rows]}
