import os
from dataclasses import dataclass
from typing import BinaryIO
from uuid import uuid4


IMAGE_MIMES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
VIDEO_MIMES = {"video/mp4", "video/quicktime", "video/webm"}
IMAGE_MAX = 5 * 1024 * 1024
VIDEO_MAX = 50 * 1024 * 1024

MIME_TO_EXT = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif",
    "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm",
}


class MediaTooLarge(Exception): pass
class MediaTypeNotAllowed(Exception): pass


@dataclass(slots=True)
class StoredMedia:
    storage_path: str
    mime_type: str
    type: str
    file_size_bytes: int


class MediaStorage:
    def __init__(self, *, root: str):
        self._root = root
        os.makedirs(root, exist_ok=True)

    def save(self, fp: BinaryIO, *, declared_mime: str, filename: str) -> StoredMedia:
        if declared_mime in IMAGE_MIMES:
            kind = "image"
            cap = IMAGE_MAX
        elif declared_mime in VIDEO_MIMES:
            kind = "video"
            cap = VIDEO_MAX
        else:
            raise MediaTypeNotAllowed(f"mime not allowed: {declared_mime}")
        data = fp.read()
        if len(data) > cap:
            raise MediaTooLarge(f"size {len(data)} > cap {cap} for {kind}")
        ext = MIME_TO_EXT.get(declared_mime, os.path.splitext(filename)[1] or "")
        path = os.path.join(self._root, f"{uuid4().hex}{ext}")
        with open(path, "wb") as out:
            out.write(data)
        return StoredMedia(storage_path=path, mime_type=declared_mime, type=kind, file_size_bytes=len(data))
