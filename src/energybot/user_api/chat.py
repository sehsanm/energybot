import os
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.db import get_session
from energybot.core.models import KBAttachment, User
from energybot.user_api.auth import current_user

router = APIRouter(prefix="/api/app", tags=["app"])


@router.get("/media/{attachment_id}")
async def media(attachment_id: str, user: User = Depends(current_user),
                session: AsyncSession = Depends(get_session)):
    try:
        aid = UUID(attachment_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    att = (await session.execute(
        select(KBAttachment).where(KBAttachment.id == aid, KBAttachment.deleted_at.is_(None))
    )).scalar_one_or_none()
    if att is None or not os.path.isfile(att.storage_path):
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(att.storage_path, media_type=att.mime_type)
