from apscheduler.schedulers.asyncio import AsyncIOScheduler
from energybot.core.db import get_sessionmaker
from energybot.jobs.cleanup import cleanup_processed_updates
from energybot.jobs.daily_stats import recompute_daily_stats
from energybot.jobs.purge import hard_purge_soft_deleted
from energybot.settings import get_settings


def make_scheduler() -> AsyncIOScheduler:
    sched = AsyncIOScheduler()
    Session = get_sessionmaker()
    s = get_settings()

    async def daily_stats_job():
        async with Session() as session:
            await recompute_daily_stats(session_factory=lambda: session)

    async def cleanup_job():
        async with Session() as session:
            await cleanup_processed_updates(session_factory=lambda: session)

    async def purge_job():
        async with Session() as session:
            await hard_purge_soft_deleted(session_factory=lambda: session, grace_days=s.soft_delete_grace_days)

    sched.add_job(daily_stats_job, "cron", hour=2, minute=15, id="daily_stats")
    sched.add_job(cleanup_job, "cron", minute=0, id="cleanup_processed_updates")
    sched.add_job(purge_job, "cron", hour=3, minute=30, id="hard_purge")
    return sched
