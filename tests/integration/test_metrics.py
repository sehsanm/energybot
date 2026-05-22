import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app(monkeypatch):
    for k, v in {"SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_metrics_endpoint_exposes_counters(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/metrics")
    assert r.status_code == 200
    assert "energybot_webhook_requests_total" in r.text
    assert "energybot_llm_calls_total" in r.text
