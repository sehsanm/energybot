import pytest
from datetime import datetime
from uuid import uuid4
from energybot.core.models import User, Profile, Bill
from energybot.billing.repository import BillingRepository
from energybot.billing.finnotech_client import BillDetail
from energybot.agent.tools.read_bills import ReadBillsTool


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000)); db_session.add(u); await db_session.flush()
    db_session.add(Profile(user_id=u.id)); await db_session.commit(); return u


@pytest.mark.asyncio
async def test_read_bills_returns_trend(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    older_bill = await repo.add_bill(u.id, sub.id, BillDetail("117709580013", None, 100000, "electricity", "1404/02", None, {}))
    newer_bill = await repo.add_bill(u.id, sub.id, BillDetail("117709580013", None, 130000, "electricity", "1404/03", None, {}))

    # Pin distinct inquired_at values so ordering is deterministic regardless of insertion timing
    older_row = await db_session.get(Bill, older_bill.id)
    newer_row = await db_session.get(Bill, newer_bill.id)
    older_row.inquired_at = datetime(2026, 1, 1)
    newer_row.inquired_at = datetime(2026, 2, 1)
    await db_session.commit()

    tool = ReadBillsTool(repo=repo, user_id=u.id)
    out = await tool.invoke({})
    assert len(out["bills"]) == 2
    assert out["trend"]["electricity"]["latest"] == 130000
    assert out["trend"]["electricity"]["delta"] == 30000
