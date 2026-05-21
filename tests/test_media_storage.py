import io
import pytest
from energybot.kb.media_storage import MediaStorage, MediaTooLarge, MediaTypeNotAllowed


@pytest.fixture
def storage(tmp_path):
    return MediaStorage(root=str(tmp_path))


def test_save_image_under_limit(storage):
    fake_png = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    info = storage.save(io.BytesIO(fake_png), declared_mime="image/png", filename="x.png")
    assert info.mime_type == "image/png"
    assert info.file_size_bytes == len(fake_png)
    assert info.type == "image"
    assert info.storage_path.endswith(".png")


def test_save_video_under_limit(storage):
    fake_mp4 = b"\x00\x00\x00\x20ftypisom" + b"\x00" * 200
    info = storage.save(io.BytesIO(fake_mp4), declared_mime="video/mp4", filename="x.mp4")
    assert info.type == "video"
    assert info.mime_type == "video/mp4"


def test_image_too_large_rejected(storage):
    huge = b"\x89PNG\r\n\x1a\n" + b"\x00" * (6 * 1024 * 1024)
    with pytest.raises(MediaTooLarge):
        storage.save(io.BytesIO(huge), declared_mime="image/png", filename="x.png")


def test_video_too_large_rejected(storage):
    huge = b"\x00\x00\x00\x20ftypisom" + b"\x00" * (51 * 1024 * 1024)
    with pytest.raises(MediaTooLarge):
        storage.save(io.BytesIO(huge), declared_mime="video/mp4", filename="x.mp4")


def test_disallowed_mime_rejected(storage):
    with pytest.raises(MediaTypeNotAllowed):
        storage.save(io.BytesIO(b"x"), declared_mime="application/x-msdownload", filename="x.exe")
