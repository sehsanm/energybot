import pytest
from httpx import ASGITransport, AsyncClient
from energybot.main import create_app


@pytest.mark.asyncio
async def test_health_ok():
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
