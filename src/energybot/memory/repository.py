from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import UserMemory

VALID_CATEGORIES: set[str] = {
    "preference", "life_context", "constraint", "interaction_style", "misc",
}


class MemoryRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def list_active(self, user_id: UUID) -> list[UserMemory]:
        s = self._session_factory()
        rows = (await s.execute(
            select(UserMemory)
            .where(UserMemory.user_id == user_id, UserMemory.deleted_at.is_(None))
            .order_by(UserMemory.category, UserMemory.id)
        )).scalars().all()
        return list(rows)

    async def count_active(self, user_id: UUID) -> int:
        s = self._session_factory()
        return int((await s.execute(
            select(func.count()).select_from(UserMemory)
            .where(UserMemory.user_id == user_id, UserMemory.deleted_at.is_(None))
        )).scalar_one())

    async def _get_active(self, s: AsyncSession, user_id: UUID, memory_id: int) -> UserMemory:
        row = (await s.execute(
            select(UserMemory).where(
                UserMemory.id == memory_id,
                UserMemory.user_id == user_id,
                UserMemory.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            raise LookupError(f"no active memory id={memory_id} for user")
        return row

    async def add(self, user_id: UUID, text: str, category: str,
                  source_message_id: int | None = None) -> UserMemory:
        if category not in VALID_CATEGORIES:
            raise ValueError(f"invalid category: {category!r}")
        s = self._session_factory()
        row = UserMemory(user_id=user_id, text=text, category=category,
                         source_message_id=source_message_id)
        s.add(row)
        await s.commit()
        await s.refresh(row)
        return row

    async def update(self, user_id: UUID, memory_id: int, *,
                     text: str | None = None, category: str | None = None) -> UserMemory:
        if category is not None and category not in VALID_CATEGORIES:
            raise ValueError(f"invalid category: {category!r}")
        s = self._session_factory()
        row = await self._get_active(s, user_id, memory_id)
        if text is not None:
            row.text = text
        if category is not None:
            row.category = category
        row.updated_at = datetime.utcnow()
        await s.commit()
        await s.refresh(row)
        return row

    async def remove(self, user_id: UUID, memory_id: int) -> None:
        s = self._session_factory()
        row = await self._get_active(s, user_id, memory_id)
        row.deleted_at = datetime.utcnow()
        await s.commit()
