import pytest
from uuid import uuid4, UUID
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.bale_adapter import handler as h
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
    # /start then complete onboarding shortcut: insert user with completed wizard
    u = User(bale_user_id=uid)
    db_session.add(u); await db_session.flush()
    from datetime import datetime
    from energybot.core.models import Profile, OnboardingState
    db_session.add(Profile(user_id=u.id))
    db_session.add(OnboardingState(user_id=u.id, current_step="main_concern", answers={}, completed_at=datetime.utcnow()))
    await db_session.commit()
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


@pytest.fixture(autouse=True)
def _no_spawn_suggestions(monkeypatch):
    """Prevent pre-existing capture tests from firing a real background suggestion task."""
    monkeypatch.setattr(h, "_spawn_suggestions", lambda *args, **kwargs: None)


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
async def test_bare_bill_id_text_creates_snapshot_with_pay_button(db_session, monkeypatch):
    # User taps "قبض من", then types just the bill id (no /bill prefix). It must be
    # routed to the billing service, not the LLM agent.
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    u = await _seed_done_user(db_session, 31004)
    upd = {"update_id": 5, "message": {"message_id": 5, "from": {"id": 31004}, "chat": {"id": 31004}, "text": _bill_id()}}
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
async def test_pdf_document_without_barcode_asks_for_manual(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    await _seed_done_user(db_session, 31005)
    upd = {"update_id": 6, "message": {"message_id": 6, "from": {"id": 31005}, "chat": {"id": 31005},
           "document": {"file_id": "doc", "file_name": "bill.pdf", "mime_type": "application/pdf"}}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    assert any("بارکد" in s["text"] for s in bale.sent)


@pytest.mark.asyncio
async def test_unsupported_document_type_is_rejected(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    await _seed_done_user(db_session, 31006)
    upd = {"update_id": 7, "message": {"message_id": 7, "from": {"id": 31006}, "chat": {"id": 31006},
           "document": {"file_id": "doc", "file_name": "notes.docx",
                        "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document"}}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    assert any("PDF" in s["text"] for s in bale.sent)


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


@pytest.mark.asyncio
async def test_send_capture_spawns_suggestions(monkeypatch):
    calls = []
    monkeypatch.setattr(h, "_spawn_suggestions",
                        lambda user_id, chat_id, bill_db_id: calls.append((user_id, chat_id, bill_db_id)))

    class _Bale:
        async def send_message(self, *, chat_id, text, reply_markup=None):
            pass

    from energybot.billing.service import CaptureResult
    bid = uuid4()
    uid = uuid4()
    res = CaptureResult(ok=True, summary="خلاصه", pay_callback=f"pay:{bid}", bill_db_id=str(bid), error=None)
    await h._send_capture(_Bale(), 777, res, uid)
    assert calls == [(uid, 777, bid)]


@pytest.mark.asyncio
async def test_send_capture_no_spawn_on_error(monkeypatch):
    calls = []
    monkeypatch.setattr(h, "_spawn_suggestions",
                        lambda user_id, chat_id, bill_db_id: calls.append(1))

    class _Bale:
        async def send_message(self, *, chat_id, text, reply_markup=None):
            pass

    from energybot.billing.service import CaptureResult
    res = CaptureResult(ok=False, summary="", pay_callback=None, bill_db_id=None, error="خطا")
    await h._send_capture(_Bale(), 777, res, uuid4())
    assert calls == []
