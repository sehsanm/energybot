import pytest
from uuid import uuid4
from energybot.core.models import User, KBArticle, KBAttachment
from energybot.agent.channels import BaleChannel
from energybot.agent.tools.send_kb_media import SendKBMediaTool


class FakeBaleClient:
    def __init__(self):
        self.sent: list[dict] = []

    async def send_photo(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None):
        info = {"chat_id": chat_id, "file_id": file_id, "file_path": file_path, "caption": caption}
        self.sent.append({"photo": info})
        return "FAKE_FILE_ID_PHOTO"

    async def send_video(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None):
        info = {"chat_id": chat_id, "file_id": file_id, "file_path": file_path, "caption": caption}
        self.sent.append({"video": info})
        return "FAKE_FILE_ID_VIDEO"


@pytest.mark.asyncio
async def test_send_image_caches_file_id(db_session):
    u = User(bale_user_id=999111)
    db_session.add(u)
    await db_session.flush()
    art = KBArticle(title="t", body="b", category="general", tags=[], status="published", version=1)
    db_session.add(art)
    await db_session.flush()
    att = KBAttachment(article_id=art.id, type="image", mime_type="image/png", file_size_bytes=10, storage_path="/tmp/x.png", caption_fa="دیاگرام")
    db_session.add(att)
    await db_session.commit()

    bale = FakeBaleClient()
    tool = SendKBMediaTool(channel=BaleChannel(bale, int(u.bale_user_id)), session_factory=lambda: db_session)
    result = await tool.invoke({"attachment_id": str(att.id), "caption": "نگاه کن"})
    assert result["ok"] is True
    assert bale.sent[0]["photo"]["file_id"] is None
    await tool.invoke({"attachment_id": str(att.id)})
    assert bale.sent[1]["photo"]["file_id"] == "FAKE_FILE_ID_PHOTO"
