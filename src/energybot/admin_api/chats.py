from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, ChatSession, Message

router = APIRouter(prefix="/api/admin", tags=["admin-chats"])


@router.get("/chats")
async def list_chats(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    rows = (await s.execute(select(ChatSession).order_by(ChatSession.started_at.desc()).limit(200))).scalars().all()
    return {"sessions": [{"id": str(r.id), "user_id": str(r.user_id), "started_at": r.started_at.isoformat()} for r in rows]}


@router.get("/chats/{session_id}")
async def get_chat(session_id: UUID, _: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    msgs = (await s.execute(select(Message).where(Message.session_id == session_id).order_by(Message.id))).scalars().all()
    return {"messages": [{"id": m.id, "role": m.role, "content": m.content, "tool_name": m.tool_name, "tool_args": m.tool_args, "tool_result": m.tool_result, "created_at": m.created_at.isoformat()} for m in msgs]}
