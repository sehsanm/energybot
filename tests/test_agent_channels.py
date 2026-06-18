import pytest
from types import SimpleNamespace
from uuid import uuid4
from energybot.agent.channels import BaleChannel, WebChannel


class _FakeBale:
    def __init__(self):
        self.photo_calls = []
        self.video_calls = []

    async def send_photo(self, *, chat_id, file_id, file_path, caption):
        self.photo_calls.append(dict(chat_id=chat_id, file_id=file_id, file_path=file_path, caption=caption))
        return "new-file-id"

    async def send_video(self, *, chat_id, file_id, file_path, caption):
        self.video_calls.append(dict(chat_id=chat_id, file_id=file_id, file_path=file_path, caption=caption))
        return "new-file-id"


def _att(**kw):
    base = dict(id=uuid4(), type="image", storage_path="/tmp/x.png", bale_file_id=None)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_bale_channel_image_uses_storage_path_and_caches_file_id():
    bale = _FakeBale()
    att = _att(type="image", bale_file_id=None)
    await BaleChannel(bale, 555).send_media(att, "کپشن")
    assert bale.photo_calls == [dict(chat_id=555, file_id=None, file_path="/tmp/x.png", caption="کپشن")]
    assert att.bale_file_id == "new-file-id"  # cached back


@pytest.mark.asyncio
async def test_bale_channel_video_with_existing_file_id_skips_path():
    bale = _FakeBale()
    att = _att(type="video", storage_path="/tmp/v.mp4", bale_file_id="cached")
    await BaleChannel(bale, 9).send_media(att, None)
    assert bale.video_calls == [dict(chat_id=9, file_id="cached", file_path=None, caption=None)]
    assert att.bale_file_id == "cached"  # unchanged


@pytest.mark.asyncio
async def test_web_channel_buffers_media_event():
    att = _att(type="image")
    web = WebChannel()
    await web.send_media(att, "کپشن")
    assert web.events == [{
        "type": "media", "attachment_id": str(att.id), "media_type": "image",
        "url": f"/api/app/media/{att.id}", "caption": "کپشن",
    }]
