import pytest
from sqlalchemy import select
from uuid import uuid4
from energybot.core.models import User, UserMemory


@pytest.mark.asyncio
async def test_insert_and_read_user_memory(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(UserMemory(user_id=u.id, text="اتاق خنک را دوست دارد", category="preference"))
    await db_session.commit()
    row = (await db_session.execute(
        select(UserMemory).where(UserMemory.user_id == u.id)
    )).scalar_one()
    assert row.id is not None
    assert row.text == "اتاق خنک را دوست دارد"
    assert row.category == "preference"
    assert row.deleted_at is None
    assert row.created_at is not None
