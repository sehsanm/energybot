from collections.abc import Callable
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBAttachment


class SendKBMediaTool:
    name = "send_kb_media"
    description = "ارسال تصویر یا ویدیوی پیوست‌شده به یک مقاله."
    parameters = {
        "type": "object",
        "properties": {
            "attachment_id": {"type": "string"},
            "caption": {"type": "string"},
        },
        "required": ["attachment_id"],
    }

    def __init__(self, *, channel, session_factory: Callable[[], AsyncSession]):
        self._channel = channel
        self._session_factory = session_factory

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        att_id = UUID(args["attachment_id"])
        s = self._session_factory()
        att = (await s.execute(
            select(KBAttachment).where(KBAttachment.id == att_id, KBAttachment.deleted_at.is_(None))
        )).scalar_one()
        caption = args.get("caption") or att.caption_fa
        await self._channel.send_media(att, caption)
        await s.commit()
        return {"ok": True}
