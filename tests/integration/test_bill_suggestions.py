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


import json as _json
from energybot.profile.repository import ProfileRepository
from energybot.core.models import Profile


class _FakeRouter:
    def __init__(self, content: str):
        self.content = content
        self.calls = 0

    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        self.calls += 1
        from energybot.providers.base import ChatResponse
        return ChatResponse(content=self.content, tokens_in=1, tokens_out=1,
                            finish_reason="stop", model="fake-model")


class _FakeLoader:
    def __init__(self):
        self.vars = None

    async def render(self, key, variables):
        self.vars = variables
        return ("PROMPT", key, 1)


class _FakeBale:
    def __init__(self):
        self.sent = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append(text)


async def _user_profile_bill(db_session):
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
             amount=2_000_000, term="1405/2",
             details={"consumption": {"total": 300, "peak": 120}, "amounts": {"period": 2_000_000}})
    db_session.add(b)
    await db_session.commit()
    return u, b


_GOOD = _json.dumps({
    "intro": "مصرفت بالاست", "tips": ["کولر را کم کن"],
    "targets": [{"text": "۱۰٪ کمتر در اوج", "metric": "peak_kwh", "baseline": 120, "target_value": 108}],
}, ensure_ascii=False)


async def test_generate_persists_appends_goal_and_sends(db_session):
    from energybot.billing.suggestions import generate_and_send_suggestions
    u, b = await _user_profile_bill(db_session)
    router, loader, bale = _FakeRouter(_GOOD), _FakeLoader(), _FakeBale()
    await generate_and_send_suggestions(
        user_id=u.id, chat_id=555, bill_db_id=b.id,
        session_factory=lambda: db_session, router=router, prompt_loader=loader, bale=bale)
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions["intro"] == "مصرفت بالاست"
    assert row.suggestions["model"] == "fake-model"
    prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)
    assert any(g["source"] == "bill_suggestion" for g in prof.goals)
    assert bale.sent and "۱۰٪ کمتر در اوج" in bale.sent[0]
    # Prompt received the household context.
    assert loader.vars["household"]["city"] == "تهران"


async def test_generate_is_idempotent_on_reupload(db_session):
    from energybot.billing.suggestions import generate_and_send_suggestions
    u, b = await _user_profile_bill(db_session)
    # Pre-existing suggestions => re-upload path.
    await BillingRepository(session_factory=lambda: db_session).set_bill_suggestions(
        b.id, {"intro": "ذخیره‌شده", "tips": [], "targets": []})
    router, bale = _FakeRouter(_GOOD), _FakeBale()
    await generate_and_send_suggestions(
        user_id=u.id, chat_id=1, bill_db_id=b.id,
        session_factory=lambda: db_session, router=router, prompt_loader=_FakeLoader(), bale=bale)
    assert router.calls == 0  # no LLM call
    prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)
    assert prof.goals == []  # no goals appended
    assert "ذخیره‌شده" in bale.sent[0]


async def test_generate_parse_failure_leaves_null(db_session):
    from energybot.billing.suggestions import generate_and_send_suggestions
    u, b = await _user_profile_bill(db_session)
    router, bale = _FakeRouter("totally not json"), _FakeBale()
    await generate_and_send_suggestions(
        user_id=u.id, chat_id=1, bill_db_id=b.id,
        session_factory=lambda: db_session, router=router, prompt_loader=_FakeLoader(), bale=bale)
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions is None
    prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)
    assert prof.goals == []
    assert bale.sent == []
