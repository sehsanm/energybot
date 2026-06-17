import httpx
import pytest
from energybot.bale_adapter.client import BaleClient


@pytest.mark.asyncio
async def test_send_message_posts_correct_payload():
    calls: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append({"url": str(request.url), "body": request.content.decode()})
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 1}})

    c = BaleClient(token="ABC", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    await c.send_message(chat_id=111, text="سلام", reply_markup={"inline_keyboard": [[{"text": "ok", "callback_data": "x"}]]})
    assert "/botABC/sendMessage" in calls[0]["url"]
    assert "سلام" in calls[0]["body"]
    assert "inline_keyboard" in calls[0]["body"]


@pytest.mark.asyncio
async def test_send_photo_supports_file_id():
    def handler(request):
        body = request.content.decode()
        assert "FILE_ABC" in body
        return httpx.Response(200, json={"ok": True, "result": {"message_id": 2}})
    c = BaleClient(token="T", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    await c.send_photo(chat_id=5, file_id="FILE_ABC", file_path=None, caption="cap")


@pytest.mark.asyncio
async def test_send_photo_uploads_file_when_no_id(tmp_path):
    f = tmp_path / "img.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\n" + b"\x00" * 20)
    def handler(request):
        assert b"img.png" in request.content or b"name=\"photo\"" in request.content
        return httpx.Response(200, json={"ok": True, "result": {"photo": [{"file_id": "RETURNED"}]}})
    c = BaleClient(token="T", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    fid = await c.send_photo(chat_id=5, file_id=None, file_path=str(f), caption=None)
    assert fid == "RETURNED"


@pytest.mark.asyncio
async def test_get_file_and_download():
    def handler(request):
        if request.url.path.endswith("/getFile"):
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "photos/x.jpg"}})
        assert request.url.path.endswith("/file/botT/photos/x.jpg")
        return httpx.Response(200, content=b"IMGBYTES")
    c = BaleClient(token="T", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    fp = await c.get_file("FID")
    assert fp == "photos/x.jpg"
    data = await c.download_file(fp)
    assert data == b"IMGBYTES"
