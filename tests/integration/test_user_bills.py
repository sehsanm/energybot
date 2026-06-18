import os
import pytest
from energybot.core.models import User, UtilitySubscription
from energybot.billing.repository import BillingRepository

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.mark.asyncio
async def test_build_billing_service_importable_and_constructs(monkeypatch):
    for k, v in dict(DATABASE_URL=TEST_DB, SESSION_SECRET="z" * 32, BALE_WEBHOOK_SECRET="x",
                     BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m").items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    from energybot.billing.factory import build_billing_service
    from energybot.billing.service import BillingService
    svc = build_billing_service(lambda: None)
    assert isinstance(svc, BillingService)


@pytest.mark.asyncio
async def test_list_subscriptions_excludes_deleted_newest_first(db_session):
    from datetime import datetime
    u = User(bale_user_id=601601)
    db_session.add(u)
    await db_session.flush()
    db_session.add(UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="111", label="A"))
    db_session.add(UtilitySubscription(user_id=u.id, utility_type="gas", bill_id="222", label="B"))
    dead = UtilitySubscription(user_id=u.id, utility_type="gas", bill_id="333", label="C", deleted_at=datetime.utcnow())
    db_session.add(dead)
    await db_session.commit()
    repo = BillingRepository(session_factory=lambda: db_session)
    subs = await repo.list_subscriptions(u.id)
    labels = [x.label for x in subs]
    assert "C" not in labels
    assert set(labels) == {"A", "B"}
    assert subs[0].label == "B"  # newest first (created after A)
