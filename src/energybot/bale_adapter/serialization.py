import asyncio
from contextlib import asynccontextmanager


class PerUserLock:
    def __init__(self):
        self._locks: dict[int, asyncio.Lock] = {}

    def _get(self, user_id: int) -> asyncio.Lock:
        lock = self._locks.get(user_id)
        if lock is None:
            lock = asyncio.Lock()
            self._locks[user_id] = lock
        return lock

    @asynccontextmanager
    async def for_user(self, user_id: int):
        lock = self._get(user_id)
        await lock.acquire()
        try:
            yield
        finally:
            lock.release()
