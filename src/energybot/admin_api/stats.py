from datetime import datetime, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, DailyStats, Message, User

router = APIRouter(prefix="/api/admin/stats", tags=["admin-stats"])


@router.get("/dashboard")
async def dashboard(_: AdminUser = Depends(current_admin), s: AsyncSession = Depends(get_session)) -> dict:
    today = datetime.utcnow().date()
    dau = (await s.execute(select(func.count(func.distinct(Message.user_id))).where(Message.created_at >= datetime.combine(today, datetime.min.time())))).scalar_one()
    messages_today = (await s.execute(select(func.count(Message.id)).where(Message.created_at >= datetime.combine(today, datetime.min.time())))).scalar_one()
    total_users = (await s.execute(select(func.count(User.id)).where(User.deleted_at.is_(None)))).scalar_one()
    history = (await s.execute(select(DailyStats).where(DailyStats.date >= today - timedelta(days=30)).order_by(DailyStats.date))).scalars().all()
    return {
        "dau": int(dau or 0),
        "messages_today": int(messages_today or 0),
        "total_users": int(total_users or 0),
        "history": [{"date": d.date.isoformat(), "dau": d.dau, "messages": d.messages, "kb_hits": d.kb_hits, "llm_cost_usd": float(d.llm_cost_usd)} for d in history],
    }
