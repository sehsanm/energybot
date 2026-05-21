import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from jinja2 import Environment, StrictUndefined
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import PromptTemplate


@dataclass(slots=True)
class _Cached:
    body: str
    version: int
    expires_at: float


class PromptLoader:
    def __init__(self, *, session_factory: Callable[[], AsyncSession], cache_ttl_seconds: int = 60):
        self._session_factory = session_factory
        self._ttl = cache_ttl_seconds
        self._cache: dict[str, _Cached] = {}
        self._env = Environment(undefined=StrictUndefined, autoescape=False)

    async def _fetch_active(self, key: str) -> _Cached:
        now = time.time()
        cached = self._cache.get(key)
        if cached and cached.expires_at > now:
            return cached
        session = self._session_factory()
        row = (await session.execute(
            select(PromptTemplate).where(PromptTemplate.key == key, PromptTemplate.status == "active")
        )).scalar_one_or_none()
        if row is None:
            raise LookupError(f"no active prompt template for key={key}")
        c = _Cached(body=row.body, version=row.version, expires_at=now + self._ttl)
        self._cache[key] = c
        return c

    async def render(self, key: str, variables: dict[str, Any]) -> tuple[str, str, int]:
        c = await self._fetch_active(key)
        return self._env.from_string(c.body).render(**variables), key, c.version

    async def activate(self, *, key: str, version: int) -> None:
        session = self._session_factory()
        async with session.begin():
            await session.execute(
                update(PromptTemplate)
                .where(PromptTemplate.key == key, PromptTemplate.status == "active")
                .values(status="retired")
            )
            row = (await session.execute(
                select(PromptTemplate).where(PromptTemplate.key == key, PromptTemplate.version == version)
            )).scalar_one()
            row.status = "active"
        self._cache.pop(key, None)
