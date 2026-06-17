import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, Bill
from energybot.billing.bill_numbers import _check_digit


def _bill_id():
    return "117709580013" + _check_digit("117709580013")


class FakeBale:
    def __init__(self):
        self.sent = []
    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"text": text, "reply_markup": reply_markup}); return 1
    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass
    async def get_file(self, file_id): return "photos/x.jpg"
    async def download_file(self, file_path): return b"img"


async def _seed_done_user(db_session, uid):
    # /start then complete onboarding shortcut: insert user with no active wizard
    u = User(bale_user_id=uid)
    db_session.add(u); await db_session.flush()
    from energybot.core.models import Profile
    db_session.add(Profile(user_id=u.id)); await db_session.commit()
    return u


@pytest.fixture(autouse=True)
def _fake_billing(monkeypatch, db_session):
    from energybot.billing.service import BillingService
    from energybot.billing.repository import BillingRepository
    from energybot.billing.finnotech_client import FakeFinnotechClient
    from energybot.billing.payment import FakePaymentProvider
    def factory(session_factory):
        return BillingService(finnotech=FakeFinnotechClient(), payment=FakePaymentProvider(),
                              repo=BillingRepository(session_factory=session_factory),
                              callback_base_url="https://bot.test", provider_name="fake")
    monkeypatch.setattr("energybot.bale_adapter.handler.build_billing_service", factory)


@pytest.mark.asyncio
async def test_typed_bill_id_creates_snapshot_with_pay_button(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    u = await _seed_done_user(db_session, 31001)
    upd = {"update_id": 1, "message": {"message_id": 1, "from": {"id": 31001}, "chat": {"id": 31001}, "text": f"/bill {_bill_id()}"}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    bills = (await db_session.execute(select(Bill).where(Bill.user_id == u.id))).scalars().all()
    assert len(bills) == 1
    assert any(s["reply_markup"] for s in bale.sent)  # pay button present


@pytest.mark.asyncio
async def test_photo_without_barcode_asks_for_manual(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    await _seed_done_user(db_session, 31002)
    upd = {"update_id": 2, "message": {"message_id": 2, "from": {"id": 31002}, "chat": {"id": 31002},
           "photo": [{"file_id": "big"}]}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    assert any("بارکد" in s["text"] for s in bale.sent)


@pytest.mark.asyncio
async def test_pay_callback_sends_pay_link(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    bale_id = 31003
    chat_id = 31003
    u = await _seed_done_user(db_session, bale_id)

    # Step 1: send /bill <valid bill id> to create a Bill row
    bill_number = _bill_id()
    upd_bill = {"update_id": 3, "message": {"message_id": 3, "from": {"id": bale_id}, "chat": {"id": chat_id}, "text": f"/bill {bill_number}"}}
    await handle_bale_update(upd_bill, session_factory=lambda: db_session)

    # Step 2: read the created Bill row to get its UUID
    bill = (await db_session.execute(select(Bill).where(Bill.user_id == u.id))).scalar_one()
    bill_db_id = bill.id

    # Step 3: send pay: callback
    upd_pay = {"update_id": 4, "callback_query": {"id": "cb1", "from": {"id": bale_id}, "message": {"chat": {"id": chat_id}}, "data": f"pay:{bill_db_id}"}}
    await handle_bale_update(upd_pay, session_factory=lambda: db_session)

    # FakePaymentProvider returns redirect_url = f"https://pay.fake/{bill_id}" where bill_id is the utility bill number
    assert any("https://pay.fake/" in s["text"] for s in bale.sent)
