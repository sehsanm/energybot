from typing import Any
import httpx


class BaleClient:
    def __init__(self, *, token: str, base_url: str = "https://tapi.bale.ai", transport: httpx.AsyncBaseTransport | None = None):
        self._token = token
        self._base = base_url.rstrip("/")
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0), transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    def _url(self, method: str) -> str:
        return f"{self._base}/bot{self._token}/{method}"

    async def _post_json(self, method: str, payload: dict[str, Any]) -> dict[str, Any]:
        r = await self._client.post(self._url(method), json=payload)
        r.raise_for_status()
        return r.json()

    async def send_message(self, *, chat_id: int, text: str, reply_markup: dict | None = None) -> int:
        payload: dict[str, Any] = {"chat_id": chat_id, "text": text}
        if reply_markup:
            payload["reply_markup"] = reply_markup
        data = await self._post_json("sendMessage", payload)
        return int(data["result"]["message_id"])

    async def send_chat_action(self, *, chat_id: int, action: str = "typing") -> None:
        # The typing indicator is cosmetic — a transient failure here shouldn't
        # abort the turn. Log at WARNING so persistent regressions stay visible.
        from energybot.logging import get_logger
        try:
            await self._post_json("sendChatAction", {"chat_id": chat_id, "action": action})
        except Exception as e:  # noqa: BLE001
            get_logger(__name__).warning("send_chat_action_failed", error=str(e), action=action)

    async def answer_callback_query(self, *, callback_query_id: str, text: str | None = None) -> None:
        await self._post_json("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text or ""})

    async def send_photo(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None) -> str | None:
        if file_id:
            await self._post_json("sendPhoto", {"chat_id": chat_id, "photo": file_id, "caption": caption or ""})
            return file_id
        assert file_path
        with open(file_path, "rb") as f:
            files = {"photo": (file_path.split("/")[-1], f.read(), "application/octet-stream")}
        r = await self._client.post(self._url("sendPhoto"), data={"chat_id": chat_id, "caption": caption or ""}, files=files)
        r.raise_for_status()
        result = r.json().get("result", {})
        photos = result.get("photo") or []
        return photos[-1]["file_id"] if photos else None

    async def send_video(self, *, chat_id: int, file_id: str | None, file_path: str | None, caption: str | None) -> str | None:
        if file_id:
            await self._post_json("sendVideo", {"chat_id": chat_id, "video": file_id, "caption": caption or ""})
            return file_id
        assert file_path
        with open(file_path, "rb") as f:
            files = {"video": (file_path.split("/")[-1], f.read(), "application/octet-stream")}
        r = await self._client.post(self._url("sendVideo"), data={"chat_id": chat_id, "caption": caption or ""}, files=files)
        r.raise_for_status()
        v = r.json().get("result", {}).get("video", {})
        return v.get("file_id")

    async def get_file(self, file_id: str) -> str:
        data = await self._post_json("getFile", {"file_id": file_id})
        return data["result"]["file_path"]

    async def download_file(self, file_path: str) -> bytes:
        url = f"{self._base}/file/bot{self._token}/{file_path}"
        r = await self._client.get(url)
        r.raise_for_status()
        return r.content
