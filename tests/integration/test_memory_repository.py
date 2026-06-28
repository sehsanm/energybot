import pytest
from uuid import uuid4
from energybot.core.models import User
from energybot.memory.repository import MemoryRepository


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_add_and_list_active(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    await repo.add(u.id, "شیفت شب کار می‌کند", "life_context")
    await repo.add(u.id, "پاسخ کوتاه می‌خواهد", "interaction_style")
    items = await repo.list_active(u.id)
    assert {i.text for i in items} == {"شیفت شب کار می‌کند", "پاسخ کوتاه می‌خواهد"}
    assert await repo.count_active(u.id) == 2


@pytest.mark.asyncio
async def test_update_changes_text_and_category(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    m = await repo.add(u.id, "اتاق خنک", "constraint")
    await repo.update(u.id, m.id, text="اتاق خیلی خنک را دوست دارد", category="preference")
    items = await repo.list_active(u.id)
    assert items[0].text == "اتاق خیلی خنک را دوست دارد"
    assert items[0].category == "preference"


@pytest.mark.asyncio
async def test_remove_soft_deletes(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    m = await repo.add(u.id, "مستأجر است", "constraint")
    await repo.remove(u.id, m.id)
    assert await repo.list_active(u.id) == []
    assert await repo.count_active(u.id) == 0


@pytest.mark.asyncio
async def test_user_scoping_isolation(db_session):
    a = await _user(db_session)
    b = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    m = await repo.add(a.id, "متعلق به الف", "misc")
    # user b cannot see or mutate user a's item
    assert await repo.list_active(b.id) == []
    with pytest.raises(LookupError):
        await repo.update(b.id, m.id, text="نفوذ")
    with pytest.raises(LookupError):
        await repo.remove(b.id, m.id)


@pytest.mark.asyncio
async def test_update_missing_id_raises(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    with pytest.raises(LookupError):
        await repo.update(u.id, 999999, text="x")


@pytest.mark.asyncio
async def test_add_invalid_category_raises(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    with pytest.raises(ValueError):
        await repo.add(u.id, "x", "not_a_category")
