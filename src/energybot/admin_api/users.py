from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, ChatSession, Profile, User

router = APIRouter(prefix="/api/admin", tags=["admin-users"])


@router.get("/users")
async def list_users(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(User).where(User.deleted_at.is_(None)).order_by(desc(User.last_seen_at)).limit(200))).scalars().all()
    return {"users": [{"id": str(u.id), "bale_user_id": u.bale_user_id, "display_name": u.display_name, "last_seen_at": u.last_seen_at.isoformat() if u.last_seen_at else None} for u in rows]}


@router.get("/users/{user_id}")
async def get_user(user_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(404)
    p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one_or_none()
    sessions = (await s.execute(select(ChatSession).where(ChatSession.user_id == user_id).order_by(desc(ChatSession.started_at)).limit(20))).scalars().all()
    return {
        "user": {"id": str(u.id), "bale_user_id": u.bale_user_id, "display_name": u.display_name, "is_blocked": u.is_blocked},
        "profile": {"household": p.household if p else {}, "behaviour": p.behaviour if p else {}, "goals": p.goals if p else [], "commitments": p.commitments if p else []},
        "sessions": [{"id": str(s2.id), "started_at": s2.started_at.isoformat()} for s2 in sessions],
    }


@router.post("/users/{user_id}/block")
async def block(user_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one()
    u.is_blocked = True
    await s.commit()
    return {"ok": True}
