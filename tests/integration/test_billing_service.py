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
