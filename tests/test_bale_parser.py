import asyncio
import pytest
from energybot.bale_adapter.parser import parse_update, UpdateText, UpdateCallback
from energybot.bale_adapter.serialization import PerUserLock


def test_parse_text_message():
    upd = {"update_id": 5, "message": {"message_id": 1, "from": {"id": 42, "first_name": "علی"}, "chat": {"id": 42, "type": "private"}, "text": "سلام"}}
    parsed = parse_update(upd)
    assert isinstance(parsed, UpdateText)
    assert parsed.update_id == 5
    assert parsed.bale_user_id == 42
    assert parsed.text == "سلام"
    assert parsed.display_name == "علی"


def test_parse_callback_query():
    upd = {"update_id": 6, "callback_query": {"id": "cb1", "from": {"id": 7}, "message": {"chat": {"id": 7}}, "data": "wizard:home_type:آپارتمان"}}
    parsed = parse_update(upd)
    assert isinstance(parsed, UpdateCallback)
    assert parsed.data == "wizard:home_type:آپارتمان"
    assert parsed.callback_id == "cb1"


@pytest.mark.asyncio
async def test_per_user_lock_serialises_same_user():
    lock = PerUserLock()
    order: list[str] = []

    async def critical(u: int, tag: str, delay: float):
        async with lock.for_user(u):
            order.append(f"{tag}-in")
            await asyncio.sleep(delay)
            order.append(f"{tag}-out")

    await asyncio.gather(critical(1, "a", 0.05), critical(1, "b", 0.01))
    assert order == ["a-in", "a-out", "b-in", "b-out"]


@pytest.mark.asyncio
async def test_per_user_lock_allows_concurrent_different_users():
    lock = PerUserLock()
    order: list[str] = []

    async def critical(u: int, tag: str, delay: float):
        async with lock.for_user(u):
            order.append(f"{tag}-in")
            await asyncio.sleep(delay)
            order.append(f"{tag}-out")

    await asyncio.gather(critical(1, "a", 0.02), critical(2, "b", 0.01))
    assert order.index("b-in") < order.index("a-out")
