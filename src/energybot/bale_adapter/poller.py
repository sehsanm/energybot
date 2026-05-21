import asyncio
from typing import Any

import httpx
from sqlalchemy import select

from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.db import get_sessionmaker
from energybot.core.models import ProcessedUpdate
from energybot.logging import get_logger

log = get_logger(__name__)


class BalePoller:
    """Long-polling consumer of Bale `getUpdates`. Single-instance only — running
    more than one poller against the same bot will cause duplicate processing."""

    def __init__(
        self,
        *,
        token: str,
        base_url: str = "https://tapi.bale.ai",
        poll_timeout: int = 30,
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self._token = token
        self._base = base_url.rstrip("/")
        self._timeout = poll_timeout
        self._offset: int | None = None
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(poll_timeout + 10), transport=transport
        )
        self._stop = asyncio.Event()

    async def aclose(self) -> None:
        await self._client.aclose()

    def _url(self, method: str) -> str:
        return f"{self._base}/bot{self._token}/{method}"

    async def _delete_webhook(self) -> None:
        """Bale won't deliver to getUpdates while a webhook is registered."""
        try:
            await self._client.post(self._url("deleteWebhook"))
        except Exception as e:  # noqa: BLE001
            log.warning("bale_delete_webhook_failed", error=str(e))

    async def _fetch(self) -> list[dict[str, Any]]:
        payload: dict[str, Any] = {"timeout": self._timeout}
        if self._offset is not None:
            payload["offset"] = self._offset
        r = await self._client.post(self._url("getUpdates"), json=payload)
        r.raise_for_status()
        data = r.json()
        if not data.get("ok"):
            raise RuntimeError(f"bale getUpdates not ok: {data}")
        return data.get("result", [])

    async def _dispatch_one(self, upd: dict[str, Any]) -> None:
        update_id = int(upd.get("update_id", 0))
        if update_id <= 0:
            return
        Session = get_sessionmaker()
        async with Session() as session:
            existing = (
                await session.execute(
                    select(ProcessedUpdate).where(ProcessedUpdate.update_id == update_id)
                )
            ).scalar_one_or_none()
            if existing is not None:
                return
            session.add(ProcessedUpdate(update_id=update_id))
            await session.commit()
            try:
                await handle_bale_update(upd, session_factory=lambda: session)
            except Exception as e:  # noqa: BLE001
                log.warning("bale_update_error", error=str(e), update_id=update_id)

    async def run(self) -> None:
        await self._delete_webhook()
        log.info("bale_poller_started", base=self._base, timeout=self._timeout)
        while not self._stop.is_set():
            try:
                updates = await self._fetch()
            except asyncio.CancelledError:
                break
            except Exception as e:  # noqa: BLE001
                log.warning("bale_poller_fetch_error", error=str(e))
                await asyncio.sleep(2)
                continue
            for upd in updates:
                await self._dispatch_one(upd)
                self._offset = int(upd.get("update_id", 0)) + 1
        log.info("bale_poller_stopped")

    def stop(self) -> None:
        self._stop.set()
