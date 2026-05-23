import os
from pathlib import Path
import pytest
from httpx import ASGITransport, AsyncClient


def _stage_admin_out(tmp_path):
    out = tmp_path / "admin_out"
    (out / "login").mkdir(parents=True)
    (out / "login" / "index.html").write_text("<!DOCTYPE html><html><body>صفحه ورود</body></html>", encoding="utf-8")
    for spa in ("users/_", "chats/_", "kb/articles/_"):
        d = out / spa
        d.mkdir(parents=True)
        (d / "index.html").write_text(f"<!DOCTYPE html><html><body>SPA:{spa}</body></html>", encoding="utf-8")
    (out / "kb" / "articles" / "new").mkdir(parents=True)
    (out / "kb" / "articles" / "new" / "index.html").write_text(
        "<!DOCTYPE html><html><body>NEW PAGE</body></html>", encoding="utf-8"
    )
    # Next.js `output: export` emits a 404.html that StaticFiles will surface as a 200-shaped
    # Response with status_code=404 — the SPA fallback must override this too.
    (out / "404.html").write_text("<!DOCTYPE html><html><body>NEXT 404</body></html>", encoding="utf-8")
    return out


@pytest.fixture
def app_with_admin(tmp_path, monkeypatch):
    _stage_admin_out(tmp_path)
    monkeypatch.setenv("ENERGYBOT_ADMIN_STATIC_DIR", str(tmp_path / "admin_out"))
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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "url,expect_marker",
    [
        ("/admin/kb/articles/1380518f-61b9-42b2-8024-7870b9163752/", "SPA:kb/articles/_"),
        ("/admin/kb/articles/1380518f-61b9-42b2-8024-7870b9163752", "SPA:kb/articles/_"),
        ("/admin/users/abc-123/", "SPA:users/_"),
        ("/admin/chats/abc-123/", "SPA:chats/_"),
    ],
)
async def test_admin_spa_dynamic_fallback(app_with_admin, url, expect_marker):
    async with AsyncClient(transport=ASGITransport(app=app_with_admin), base_url="http://t") as c:
        r = await c.get(url)
    assert r.status_code == 200, r.text
    assert expect_marker in r.text


@pytest.mark.asyncio
async def test_admin_spa_does_not_shadow_static_siblings(app_with_admin):
    async with AsyncClient(transport=ASGITransport(app=app_with_admin), base_url="http://t") as c:
        r_new = await c.get("/admin/kb/articles/new/")
        r_placeholder = await c.get("/admin/kb/articles/_/")
    assert r_new.status_code == 200
    assert "NEW PAGE" in r_new.text
    assert r_placeholder.status_code == 200
    assert "SPA:kb/articles/_" in r_placeholder.text
