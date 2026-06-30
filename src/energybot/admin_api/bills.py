from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, AuditLog, User
from energybot.billing.repository import BillingRepository
from energybot.billing import suggestions as suggestions_mod

router = APIRouter(prefix="/api/admin", tags=["admin-bills"])


def _bill_dict(b) -> dict[str, Any]:
    return {
        "id": str(b.id), "utility_type": b.utility_type, "amount": int(b.amount),
        "term": b.term,
        "consumption": float(b.consumption) if b.consumption is not None else None,
        "status": b.status,
        "inquired_at": b.inquired_at.isoformat() if b.inquired_at else None,
        "details": b.details or {},
        "suggestions": b.suggestions,
    }


async def _owned_bill(s: AsyncSession, user_id: UUID, bill_id: UUID):
    bill = await BillingRepository(session_factory=lambda: s).get_bill_by_id(bill_id)
    if bill is None or bill.user_id != user_id:
        raise HTTPException(404)
    return bill


@router.get("/users/{user_id}/bills")
async def list_user_bills(user_id: UUID, _: AdminUser = Depends(current_admin),
                          s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(404)
    bills = await BillingRepository(session_factory=lambda: s).recent_bills(user_id, limit=24)
    return {"bills": [_bill_dict(b) for b in bills]}


@router.post("/users/{user_id}/bills/{bill_id}/suggestions/regenerate")
async def regenerate_bill_suggestions(user_id: UUID, bill_id: UUID,
                                      _: AdminUser = Depends(current_admin),
                                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    await _owned_bill(s, user_id, bill_id)
    payload = await suggestions_mod.regenerate_suggestions(bill_db_id=bill_id, session_factory=lambda: s)
    if payload is None:
        raise HTTPException(502, detail="generation failed")
    return {"suggestions": payload}


@router.post("/users/{user_id}/bills/{bill_id}/suggestions/send")
async def send_bill_suggestions(user_id: UUID, bill_id: UUID,
                                admin: AdminUser = Depends(current_admin),
                                s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    await _owned_bill(s, user_id, bill_id)
    ok = await suggestions_mod.send_suggestions(bill_db_id=bill_id, session_factory=lambda: s)
    if not ok:
        raise HTTPException(409, detail="no suggestions to send")
    s.add(AuditLog(admin_user_id=admin.id, action="send_bill_suggestions",
                   entity_type="bill", entity_id=str(bill_id), before=None, after=None))
    await s.commit()
    return {"ok": True}
