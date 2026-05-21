import io
import pytest
from sqlalchemy import select
from energybot.core.models import KBAttachment, VideoTranscript
from energybot.kb.repository import KBRepository
from energybot.kb.media_storage import MediaStorage
from energybot.kb.transcribe import TranscriptionService


class FakeRouter:
    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        from energybot.providers.base import ChatResponse
        return ChatResponse(content="رونوشت فارسی", tokens_in=1, tokens_out=1, finish_reason="stop")


@pytest.mark.asyncio
async def test_add_image_attachment(tmp_path, db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="b", category="general", tags=[], created_by=None)
    storage = MediaStorage(root=str(tmp_path))
    fake = b"\x89PNG\r\n\x1a\n" + b"\x00" * 10
    att_id = await repo.add_attachment(
        aid, storage=storage, fp=io.BytesIO(fake), declared_mime="image/png", filename="d.png", caption_fa="دیاگرام",
    )
    row = (await db_session.execute(select(KBAttachment).where(KBAttachment.id == att_id))).scalar_one()
    assert row.type == "image"
    assert row.caption_fa == "دیاگرام"


@pytest.mark.asyncio
async def test_add_video_attachment_triggers_transcript(tmp_path, db_session):
    repo = KBRepository(session_factory=lambda: db_session)
    aid = await repo.create(title="x", body="b", category="general", tags=[], created_by=None)
    storage = MediaStorage(root=str(tmp_path))
    transcribe = TranscriptionService(router=FakeRouter())
    fake = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 200
    att_id = await repo.add_attachment(
        aid, storage=storage, fp=io.BytesIO(fake), declared_mime="video/mp4", filename="v.mp4", caption_fa="ویدیو",
    )
    await transcribe.transcribe_attachment(att_id, session_factory=lambda: db_session)
    t = (await db_session.execute(select(VideoTranscript).where(VideoTranscript.attachment_id == att_id))).scalar_one()
    assert t.text == "رونوشت فارسی"
    assert t.is_admin_edited is False
