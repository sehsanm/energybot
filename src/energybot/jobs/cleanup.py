from collections.abc import Callable
from datetime import datetime, timedelta
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import ProcessedUpdate


async def cleanup_processed_updates(*, session_factory: Callable[[], AsyncSession]) -> None:
    s = session_factory()
    cutoff = datetime.utcnow() - timedelta(hours=24)
    await s.execute(delete(ProcessedUpdate).where(ProcessedUpdate.created_at < cutoff))
    await s.commit()
