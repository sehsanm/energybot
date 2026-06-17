import pytest
from uuid import uuid4
from energybot.core.models import User, Profile
from energybot.billing.repository import BillingRepository
from energybot.billing.finnotech_client import BillDetail
from energybot.billing.payment import PaymentSession


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


def _detail():
    return BillDetail(bill_id="117709580013", pay_id="0151101290107", amount=152000,
                      utility_type="electricity", term="1404/03", due_date="1404/04/15", raw={"k": "v"})


@pytest.mark.asyncio
async def test_subscription_is_idempotent(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    s1 = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    s2 = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    assert s1.id == s2.id


@pytest.mark.asyncio
async def test_add_bill_and_recent(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    bill = await repo.add_bill(u.id, sub.id, _detail())
    assert bill.amount == 152000
    recent = await repo.recent_bills(u.id)
    assert recent[0].id == bill.id


@pytest.mark.asyncio
async def test_payment_lifecycle_marks_bill_paid(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    bill = await repo.add_bill(u.id, sub.id, _detail())
    pay = await repo.create_payment(u.id, bill_db_id=bill.id, chat_id=999, provider="fake",
                                    amount=152000, session=PaymentSession("https://pay/x", "REF1", {}))
    found = await repo.get_payment_by_ref("REF1")
    assert found.id == pay.id
    await repo.mark_payment(pay.id, success=True, raw={"ok": 1})
    recent = await repo.recent_bills(u.id)
    assert recent[0].status == "paid"
