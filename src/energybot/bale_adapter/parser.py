from dataclasses import dataclass
from typing import Union


@dataclass(slots=True)
class UpdateText:
    update_id: int
    bale_user_id: int
    chat_id: int
    text: str
    display_name: str | None


@dataclass(slots=True)
class UpdateCallback:
    update_id: int
    bale_user_id: int
    chat_id: int
    callback_id: str
    data: str


@dataclass(slots=True)
class UpdatePhoto:
    update_id: int
    bale_user_id: int
    chat_id: int
    file_id: str
    caption: str | None
    display_name: str | None


@dataclass(slots=True)
class UpdateDocument:
    update_id: int
    bale_user_id: int
    chat_id: int
    file_id: str
    mime_type: str | None
    file_name: str | None
    caption: str | None
    display_name: str | None


@dataclass(slots=True)
class UpdateUnknown:
    update_id: int


def parse_update(d: dict) -> Union[UpdateText, UpdateCallback, UpdatePhoto, UpdateDocument, UpdateUnknown]:
    upd = d.get("update_id", 0)
    if "message" in d and "text" in d["message"]:
        m = d["message"]
        return UpdateText(
            update_id=int(upd),
            bale_user_id=int(m["from"]["id"]),
            chat_id=int(m["chat"]["id"]),
            text=m["text"],
            display_name=m["from"].get("first_name"),
        )
    if "message" in d and "photo" in d["message"]:
        m = d["message"]
        photos = m["photo"]
        return UpdatePhoto(
            update_id=int(upd),
            bale_user_id=int(m["from"]["id"]),
            chat_id=int(m["chat"]["id"]),
            file_id=str(photos[-1]["file_id"]),
            caption=m.get("caption"),
            display_name=m["from"].get("first_name"),
        )
    if "message" in d and "document" in d["message"]:
        m = d["message"]
        doc = m["document"]
        return UpdateDocument(
            update_id=int(upd),
            bale_user_id=int(m["from"]["id"]),
            chat_id=int(m["chat"]["id"]),
            file_id=str(doc["file_id"]),
            mime_type=doc.get("mime_type"),
            file_name=doc.get("file_name"),
            caption=m.get("caption"),
            display_name=m["from"].get("first_name"),
        )
    if "callback_query" in d:
        c = d["callback_query"]
        return UpdateCallback(
            update_id=int(upd),
            bale_user_id=int(c["from"]["id"]),
            chat_id=int(c.get("message", {}).get("chat", {}).get("id", c["from"]["id"])),
            callback_id=str(c["id"]),
            data=str(c.get("data", "")),
        )
    return UpdateUnknown(update_id=int(upd))
