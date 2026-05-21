from apscheduler.schedulers.asyncio import AsyncIOScheduler
from energybot.core.db import get_sessionmaker
from energybot.jobs.daily_stats import recompute_daily_stats


def make_scheduler() -> AsyncIOScheduler:
    sched = AsyncIOScheduler()
    Session = get_sessionmaker()

    async def daily_stats_job():
        async with Session() as s:
            await recompute_daily_stats(session_factory=lambda: s)

    sched.add_job(daily_stats_job, "cron", hour=2, minute=15, id="daily_stats")
    return sched
