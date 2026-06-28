import pytest
from uuid import uuid4
from energybot.core.models import User
from energybot.memory.repository import MemoryRepository
from energybot.agent.tools.manage_memory import ManageMemoryTool, MEMORY_SOFT_CAP


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    await db_session.commit()
    return u


def _tool(db_session, user_id):
    repo = MemoryRepository(session_factory=lambda: db_session)
    return ManageMemoryTool(repo=repo, user_id=user_id, current_message_id=None), repo


@pytest.mark.asyncio
async def test_add_creates_item(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    out = await tool.invoke({"action": "add", "text": "اتاق خنک", "category": "preference"})
    assert out["memory_id"] is not None
    items = await repo.list_active(u.id)
    assert items[0].text == "اتاق خنک"


@pytest.mark.asyncio
async def test_add_requires_text_and_category(db_session):
    u = await _user(db_session)
    tool, _ = _tool(db_session, u.id)
    with pytest.raises(ValueError):
        await tool.invoke({"action": "add", "text": "بدون دسته"})


@pytest.mark.asyncio
async def test_update_changes_item(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    add = await tool.invoke({"action": "add", "text": "قدیمی", "category": "misc"})
    await tool.invoke({"action": "update", "memory_id": add["memory_id"], "text": "جدید"})
    assert (await repo.list_active(u.id))[0].text == "جدید"


@pytest.mark.asyncio
async def test_remove_deletes_item(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    add = await tool.invoke({"action": "add", "text": "حذف‌شو", "category": "misc"})
    out = await tool.invoke({"action": "remove", "memory_id": add["memory_id"]})
    assert out["ok"] is True
    assert await repo.list_active(u.id) == []


@pytest.mark.asyncio
async def test_add_at_soft_cap_returns_note(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    for i in range(MEMORY_SOFT_CAP):
        await repo.add(u.id, f"مورد {i}", "misc")
    out = await tool.invoke({"action": "add", "text": "یکی بیشتر", "category": "misc"})
    assert out["memory_id"] is not None
    assert "note" in out  # nudge to consolidate
