import pytest
from uuid import uuid4
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, Profile, UtilitySubscription, Bill, BillPayment


async def _seed_payment(db_session, gateway_ref, chat_id):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000)); db_session.add(u); await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="117709580013")
    db_session.add(sub); await db_session.flush()
    bill = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity", amount=152000, status="inquired", raw_inquiry={})
    db_session.add(bill); await db_session.flush()
    pay = BillPayment(bill_db_id=bill.id, user_id=u.id, chat_id=chat_id, provider="fake",
                      amount=152000, status="pending", gateway_ref=gateway_ref, raw={})
    db_session.add(pay); await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_callback_verifies_and_notifies(db_session, monkeypatch):
    sent = []
    class FakeBale:
        async def send_message(self, *, chat_id, text, reply_markup=None): sent.append((chat_id, text)); return 1
    monkeypatch.setattr("energybot.billing.callback.get_bale_client", lambda: FakeBale())
    monkeypatch.setattr("energybot.billing.callback.get_session_factory_for_request", lambda: (lambda: db_session))

    from energybot.billing.payment import FakePaymentProvider
    from energybot.billing.repository import BillingRepository
    from energybot.billing.service import BillingService
    def fake_service(session_factory):
        return BillingService(finnotech=None, payment=FakePaymentProvider(),
                              repo=BillingRepository(session_factory=session_factory),
                              callback_base_url="https://bot.test", provider_name="fake")
    monkeypatch.setattr("energybot.billing.callback.build_billing_service", fake_service)

    await _seed_payment(db_session, "REF-OK", chat_id=4242)
    from energybot.billing.callback import router
    from fastapi import FastAPI
    app = FastAPI(); app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/pay/callback", params={"authority": "REF-OK", "ok": "1"})
    assert r.status_code == 200
    assert "موفق" in r.text
    assert sent and sent[0][0] == 4242


@pytest.mark.asyncio
async def test_callback_declined_payment_shows_failure_page(db_session, monkeypatch):
    sent = []
    class FakeBale:
        async def send_message(self, *, chat_id, text, reply_markup=None): sent.append((chat_id, text)); return 1
    monkeypatch.setattr("energybot.billing.callback.get_bale_client", lambda: FakeBale())
    monkeypatch.setattr("energybot.billing.callback.get_session_factory_for_request", lambda: (lambda: db_session))

    from energybot.billing.payment import FakePaymentProvider
    from energybot.billing.repository import BillingRepository
    from energybot.billing.service import BillingService
    def fake_service(session_factory):
        return BillingService(finnotech=None, payment=FakePaymentProvider(),
                              repo=BillingRepository(session_factory=session_factory),
                              callback_base_url="https://bot.test", provider_name="fake")
    monkeypatch.setattr("energybot.billing.callback.build_billing_service", fake_service)

    await _seed_payment(db_session, "REF-FAIL", chat_id=5151)
    from energybot.billing.callback import router
    from fastapi import FastAPI
    app = FastAPI(); app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/pay/callback", params={"authority": "REF-FAIL", "ok": "0"})
    assert r.status_code == 200
    assert "ناموفق" in r.text
    assert "موفق" not in r.text.replace("ناموفق", "")
    assert sent and sent[0][0] == 5151
    assert "ناموفق" in sent[0][1]


@pytest.mark.asyncio
async def test_callback_exception_in_complete_payment_shows_failure_page(db_session, monkeypatch):
    sent = []
    class FakeBale:
        async def send_message(self, *, chat_id, text, reply_markup=None): sent.append((chat_id, text)); return 1
    monkeypatch.setattr("energybot.billing.callback.get_bale_client", lambda: FakeBale())
    monkeypatch.setattr("energybot.billing.callback.get_session_factory_for_request", lambda: (lambda: db_session))

    from energybot.billing.payment import FakePaymentProvider
    from energybot.billing.repository import BillingRepository
    from energybot.billing.service import BillingService
    def fake_service(session_factory):
        return BillingService(finnotech=None, payment=FakePaymentProvider(),
                              repo=BillingRepository(session_factory=session_factory),
                              callback_base_url="https://bot.test", provider_name="fake")
    monkeypatch.setattr("energybot.billing.callback.build_billing_service", fake_service)

    # No payment seeded for this ref — complete_payment raises ValueError("payment not found")
    from energybot.billing.callback import router
    from fastapi import FastAPI
    app = FastAPI(); app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/pay/callback", params={"authority": "REF-MISSING"})
    assert r.status_code == 200
    assert "ناموفق" in r.text
    # Exception path: no Bale notify is sent (outer except returns immediately)
    assert sent == []
