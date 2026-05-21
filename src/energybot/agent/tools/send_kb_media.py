from collections.abc import Callable
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBAttachment


class SendKBMediaTool:
    name = "send_kb_media"
    description = "ارسال تصویر یا ویدیوی پیوست‌شده به یک مقاله از طریق بله."
    parameters = {
        "type": "object",
        "properties": {
            "attachment_id": {"type": "string"},
            "caption": {"type": "string"},
        },
        "required": ["attachment_id"],
    }

    def __init__(self, *, bale, session_factory: Callable[[], AsyncSession], chat_id: int):
        self._bale = bale
        self._session_factory = session_factory
        self._chat_id = chat_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        att_id = UUID(args["attachment_id"])
        s = self._session_factory()
        att = (await s.execute(select(KBAttachment).where(KBAttachment.id == att_id, KBAttachment.deleted_at.is_(None)))).scalar_one()
        caption = args.get("caption") or att.caption_fa
        if att.type == "image":
            returned = await self._bale.send_photo(
                chat_id=self._chat_id, file_id=att.bale_file_id,
                file_path=att.storage_path if not att.bale_file_id else None,
                caption=caption,
            )
        else:
            returned = await self._bale.send_video(
                chat_id=self._chat_id, file_id=att.bale_file_id,
                file_path=att.storage_path if not att.bale_file_id else None,
                caption=caption,
            )
        if returned and not att.bale_file_id:
            att.bale_file_id = returned
            await s.commit()
        return {"ok": True}
