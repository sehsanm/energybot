from collections.abc import Callable
from datetime import date, datetime, timedelta
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import DailyStats, Message


async def recompute_daily_stats(*, session_factory: Callable[[], AsyncSession], for_date: date | None = None) -> None:
    target = for_date or (datetime.utcnow().date() - timedelta(days=1))
    start = datetime.combine(target, datetime.min.time())
    end = start + timedelta(days=1)
    s = session_factory()
    dau = (await s.execute(select(func.count(func.distinct(Message.user_id))).where(Message.created_at >= start, Message.created_at < end))).scalar_one()
    msgs = (await s.execute(select(func.count(Message.id)).where(Message.created_at >= start, Message.created_at < end))).scalar_one()
    kb_hits = (await s.execute(select(func.count(Message.id)).where(Message.created_at >= start, Message.created_at < end, Message.tool_name == "search_knowledge_base"))).scalar_one()
    tokens_total = (await s.execute(select(func.coalesce(func.sum(Message.tokens_in + Message.tokens_out), 0)).where(Message.created_at >= start, Message.created_at < end))).scalar_one()
    await s.execute(delete(DailyStats).where(DailyStats.date == target))
    s.add(DailyStats(date=target, dau=int(dau or 0), messages=int(msgs or 0),
                     kb_hits=int(kb_hits or 0), llm_cost_usd=0, tokens_total=int(tokens_total or 0)))
    await s.commit()
