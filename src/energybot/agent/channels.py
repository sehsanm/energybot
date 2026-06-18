from typing import Any, Protocol
from energybot.core.models import KBAttachment


class ResponseChannel(Protocol):
    async def send_media(self, attachment: KBAttachment, caption: str | None) -> None: ...


class BaleChannel:
    def __init__(self, bale, chat_id: int):
        self._bale = bale
        self._chat_id = chat_id

    async def send_media(self, attachment: KBAttachment, caption: str | None) -> None:
        file_path = attachment.storage_path if not attachment.bale_file_id else None
        if attachment.type == "image":
            returned = await self._bale.send_photo(
                chat_id=self._chat_id, file_id=attachment.bale_file_id,
                file_path=file_path, caption=caption,
            )
        else:
            returned = await self._bale.send_video(
                chat_id=self._chat_id, file_id=attachment.bale_file_id,
                file_path=file_path, caption=caption,
            )
        if returned and not attachment.bale_file_id:
            attachment.bale_file_id = returned


class WebChannel:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def send_media(self, attachment: KBAttachment, caption: str | None) -> None:
        self.events.append({
            "type": "media",
            "attachment_id": str(attachment.id),
            "media_type": attachment.type,
            "url": f"/api/app/media/{attachment.id}",
            "caption": caption,
        })
