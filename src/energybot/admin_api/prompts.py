from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session, get_sessionmaker
from energybot.core.models import AdminUser, PromptTemplate
from energybot.agent.prompts import PromptLoader

router = APIRouter(prefix="/api/admin/prompts", tags=["admin-prompts"])


@router.get("")
async def list_prompts(key: str | None = None, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    q = select(PromptTemplate)
    if key:
        q = q.where(PromptTemplate.key == key)
    rows = (await s.execute(q.order_by(PromptTemplate.key, PromptTemplate.version.desc()))).scalars().all()
    return {"prompts": [{"id": str(r.id), "key": r.key, "name": r.name, "version": r.version, "status": r.status, "body": r.body} for r in rows]}


@router.post("")
async def create_prompt(payload: dict, admin: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    next_v = (await s.execute(select(func.coalesce(func.max(PromptTemplate.version), 0) + 1).where(PromptTemplate.key == payload["key"]))).scalar_one()
    p = PromptTemplate(key=payload["key"], name=payload["name"], body=payload["body"], version=int(next_v), status="draft", created_by=admin.id, notes=payload.get("notes"))
    s.add(p)
    await s.commit()
    return {"id": str(p.id), "version": p.version}


@router.post("/{prompt_id}/activate")
async def activate(prompt_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    row = (await s.execute(select(PromptTemplate).where(PromptTemplate.id == prompt_id))).scalar_one()
    Session = get_sessionmaker()
    loader = PromptLoader(session_factory=Session, cache_ttl_seconds=0)
    await loader.activate(key=row.key, version=row.version)
    return {"ok": True}
