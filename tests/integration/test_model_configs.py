import pytest
from energybot.agent.model_configs import ModelConfigService
from energybot.core.models import ModelConfig


@pytest.mark.asyncio
async def test_activate_flips_invariant_atomically(db_session):
    db_session.add(ModelConfig(call_type="chat_reasoning", provider="frontier", model_name="gpt-4o-mini", is_active=True))
    db_session.add(ModelConfig(call_type="chat_reasoning", provider="metis", model_name="metis-chat-pro", is_active=False))
    await db_session.commit()
    svc = ModelConfigService(session_factory=lambda: db_session)
    rows = await svc.list_for_call_type("chat_reasoning")
    metis = next(r for r in rows if r.provider == "metis")
    await svc.activate(metis.id)
    active = await svc.get_active("chat_reasoning")
    assert active.provider == "metis"
