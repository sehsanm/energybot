import os
import pytest
from uuid import uuid4
from sqlalchemy import select
from energybot.core.models import User, UtilitySubscription, Bill

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)
pytestmark = pytest.mark.asyncio


async def _bill(db_session, *, suggestions=None) -> Bill:
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
             amount=1_000_000, term="1405/2", details={}, suggestions=suggestions)
    db_session.add(b)
    await db_session.commit()
    return b


async def test_bill_suggestions_column_roundtrips(db_session):
    b = await _bill(db_session, suggestions={"intro": "x", "tips": [], "targets": []})
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions == {"intro": "x", "tips": [], "targets": []}


async def test_bill_suggestions_defaults_none(db_session):
    b = await _bill(db_session)
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions is None
