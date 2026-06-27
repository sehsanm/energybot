import os
import pytest
from uuid import uuid4
from sqlalchemy import select
from energybot.core.models import User, UtilitySubscription, Bill
from energybot.billing.repository import BillingRepository

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


async def _sub_with_bills(db_session, n: int):
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    bills = []
    for i in range(n):
        b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                 amount=1_000_000 + i, term=f"1405/{i}", details={})
        db_session.add(b)
        await db_session.flush()
        bills.append(b)
    await db_session.commit()
    return u, sub, bills


async def test_set_bill_suggestions_persists(db_session):
    _, _, bills = await _sub_with_bills(db_session, 1)
    repo = BillingRepository(session_factory=lambda: db_session)
    await repo.set_bill_suggestions(bills[0].id, {"intro": "x", "tips": [], "targets": []})
    row = (await db_session.execute(select(Bill).where(Bill.id == bills[0].id))).scalar_one()
    assert row.suggestions == {"intro": "x", "tips": [], "targets": []}


async def test_prior_bills_excludes_current_newest_first(db_session):
    _, sub, bills = await _sub_with_bills(db_session, 3)
    repo = BillingRepository(session_factory=lambda: db_session)
    prior = await repo.prior_bills_for_subscription(sub.id, before_bill_id=bills[-1].id, limit=5)
    ids = [b.id for b in prior]
    assert bills[-1].id not in ids
    assert len(ids) == 2
