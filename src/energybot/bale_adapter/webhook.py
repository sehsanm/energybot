from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.db import get_session
from energybot.core.models import ProcessedUpdate
from energybot.logging import get_logger
from energybot.metrics import webhook_requests
from energybot.settings import get_settings

log = get_logger(__name__)
router = APIRouter()


@router.post("/bale/webhook/{secret}")
async def webhook(secret: str, request: Request, session: AsyncSession = Depends(get_session)) -> Response:
    s = get_settings()
    if secret != s.bale_webhook_secret:
        raise HTTPException(status_code=404)
    body = await request.json()
    update_id = int(body.get("update_id", 0))
    if update_id <= 0:
        return Response(status_code=200)
    existing = (await session.execute(select(ProcessedUpdate).where(ProcessedUpdate.update_id == update_id))).scalar_one_or_none()
    if existing is not None:
        return Response(status_code=200)
    session.add(ProcessedUpdate(update_id=update_id))
    await session.commit()
    try:
        await handle_bale_update(body, session_factory=lambda: session)
        webhook_requests.labels(status="ok").inc()
    except Exception as e:
        webhook_requests.labels(status="error").inc()
        log.warning("bale_webhook_error", error=str(e), update_id=update_id)
    return Response(status_code=200)
