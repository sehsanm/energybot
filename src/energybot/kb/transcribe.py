from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBAttachment, VideoTranscript
from energybot.providers.base import ChatMessage, ChatRequest


SYSTEM = "تو یک رونویس فارسی هستی. متن گفته شده در ویدیو را به‌صورت دقیق و خوانا بنویس."


class TranscriptionService:
    def __init__(self, *, router):
        self._router = router

    async def transcribe_attachment(self, attachment_id: UUID, *, session_factory: Callable[[], AsyncSession]) -> None:
        s = session_factory()
        att = (await s.execute(select(KBAttachment).where(KBAttachment.id == attachment_id))).scalar_one()
        if att.type != "video":
            raise ValueError("only video attachments can be transcribed")
        # Phase-1 placeholder body: real impl uses Whisper via a multipart upload.
        # Implementer: when wiring real Whisper, replace this with the actual transcription provider call
        # using `call_type='transcribe'`.
        req = ChatRequest(model="", messages=[
            ChatMessage(role="system", content=SYSTEM),
            ChatMessage(role="user", content=f"(audio at {att.storage_path})"),
        ])
        resp = await self._router.chat(call_type="transcribe", req=req)
        t = (await s.execute(select(VideoTranscript).where(VideoTranscript.attachment_id == attachment_id))).scalar_one_or_none()
        if t is None:
            t = VideoTranscript(attachment_id=attachment_id, text=resp.content)
            s.add(t)
        else:
            t.text = resp.content
            t.updated_at = datetime.utcnow()
        await s.commit()
