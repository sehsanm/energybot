from collections.abc import Callable
from datetime import datetime, timedelta
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBArticle, Message, Profile, User


async def hard_purge_soft_deleted(*, session_factory: Callable[[], AsyncSession], grace_days: int = 30) -> None:
    s = session_factory()
    cutoff = datetime.utcnow() - timedelta(days=grace_days)
    await s.execute(delete(Message).where(Message.deleted_at.is_not(None), Message.deleted_at < cutoff))
    await s.execute(delete(Profile).where(Profile.deleted_at.is_not(None), Profile.deleted_at < cutoff))
    await s.execute(delete(KBArticle).where(KBArticle.deleted_at.is_not(None), KBArticle.deleted_at < cutoff))
    await s.execute(delete(User).where(User.deleted_at.is_not(None), User.deleted_at < cutoff))
    await s.commit()
