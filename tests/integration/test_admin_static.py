import os
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture
def app_with_admin(tmp_path, monkeypatch):
    # Stage a fake static build
    out = tmp_path / "admin_out"
    (out / "login").mkdir(parents=True)
    (out / "login" / "index.html").write_text("<!DOCTYPE html><html><body>صفحه ورود</body></html>", encoding="utf-8")
    monkeypatch.setenv("ENERGYBOT_ADMIN_STATIC_DIR", str(out))
    for k, v in {"SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x", "BALE_BOT_TOKEN": "t",
                  "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_admin_static_login_served(app_with_admin):
    async with AsyncClient(transport=ASGITransport(app=app_with_admin), base_url="http://t") as c:
        r = await c.get("/admin/login/")
    assert r.status_code == 200
    assert "صفحه ورود" in r.text
