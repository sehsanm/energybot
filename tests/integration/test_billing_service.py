import pytest
from uuid import uuid4
from energybot.core.models import User, Profile, Bill
from sqlalchemy import select
from energybot.billing.repository import BillingRepository
from energybot.billing.finnotech_client import FakeFinnotechClient
from energybot.billing.payment import FakePaymentProvider
from energybot.billing.service import BillingService
from energybot.billing.bill_numbers import _check_digit


def _bill_id():
    return "117709580013" + _check_digit("117709580013")


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


def _service(db_session, fin=None):
    repo = BillingRepository(session_factory=lambda: db_session)
    return BillingService(
        finnotech=fin or FakeFinnotechClient(),
        payment=FakePaymentProvider(), repo=repo,
        callback_base_url="https://bot.test", provider_name="fake",
    )


@pytest.mark.asyncio
async def test_handle_text_input_inquires_and_snapshots(db_session):
    u = await _user(db_session)
    svc = _service(db_session)
    res = await svc.handle_input(u.id, text=_bill_id())
    assert res.ok is True
    assert "تومان" in res.summary or "ریال" in res.summary
    assert res.bill_db_id is not None
    bills = (await db_session.execute(select(Bill).where(Bill.user_id == u.id))).scalars().all()
    assert len(bills) == 1


@pytest.mark.asyncio
async def test_handle_invalid_text_returns_friendly_error(db_session):
    u = await _user(db_session)
    svc = _service(db_session)
    res = await svc.handle_input(u.id, text="سلام")
    assert res.ok is False
    assert res.error


@pytest.mark.asyncio
async def test_start_and_complete_payment(db_session):
    u = await _user(db_session)
    svc = _service(db_session)
    res = await svc.handle_input(u.id, text=_bill_id())
    from uuid import UUID
    url = await svc.start_payment(u.id, chat_id=555, bill_db_id=UUID(res.bill_db_id))
    assert url.startswith("https://pay.fake/")
    # The fake provider's gateway_ref is REF-<bill_id>
    chat_id, success = await svc.complete_payment(f"REF-{_bill_id()}", {"ok": "1"})
    assert chat_id == 555 and success is True


class _CountingFin:
    """Fake Finnotech that records how many times inquire_bill is called."""
    def __init__(self):
        self.calls = 0
    async def inquire_bill(self, bill_id):
        from energybot.billing.finnotech_client import BillDetail
        self.calls += 1
        return BillDetail(
            bill_id=bill_id, pay_id="649250240", amount=6492000,
            utility_type="electricity", term="1405/2", due_date="1405/03/31", raw={},
            details={"amounts": {"period": 10775136, "pay_amount": 6492000},
                     "consumption": {"total": 675, "unit": "kWh"}})


@pytest.mark.asyncio
async def test_second_inquiry_is_cached(db_session):
    u = await _user(db_session)
    fin = _CountingFin()
    svc = _service(db_session, fin=fin)
    first = await svc.handle_input(u.id, text=_bill_id())
    second = await svc.handle_input(u.id, text=_bill_id())
    assert fin.calls == 1                       # Finnotech hit once
    assert first.bill_db_id == second.bill_db_id
    assert first.summary == second.summary
    bills = (await db_session.execute(select(Bill).where(Bill.user_id == u.id))).scalars().all()
    assert len(bills) == 1                       # no duplicate row


@pytest.mark.asyncio
async def test_payment_charges_pay_amount(db_session):
    from uuid import UUID
    from energybot.core.models import BillPayment
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    svc = _service(db_session, fin=_CountingFin())
    res = await svc.handle_input(u.id, text=_bill_id())
    bill = await repo.get_bill_by_id(UUID(res.bill_db_id))
    assert int(bill.amount) == 10775136          # period cost stored
    await svc.start_payment(u.id, chat_id=1, bill_db_id=UUID(res.bill_db_id))
    rec = (await db_session.execute(
        select(BillPayment).where(BillPayment.user_id == u.id))).scalars().first()
    assert int(rec.amount) == 6492000            # pay_amount, not period
