import pytest
from energybot.settings import Settings


def test_settings_loads_from_env(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://u:p@h:5432/d")
    monkeypatch.setenv("BALE_BOT_TOKEN", "x")
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("METIS_API_KEY", "m")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    s = Settings()
    assert s.database_url.endswith("/d")
    assert s.media_root.endswith("media")
    assert s.summary_message_threshold == 20
    assert s.tool_iteration_cap == 6


def test_settings_requires_database_url(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setenv("BALE_BOT_TOKEN", "x")
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("METIS_API_KEY", "m")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    with pytest.raises(Exception):
        # Disable loading from a real .env so this test is hermetic
        # regardless of whether a dev .env exists in the working directory.
        Settings(_env_file=None)


def test_billing_settings_have_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x/y")
    monkeypatch.setenv("BALE_BOT_TOKEN", "t")
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    monkeypatch.setenv("SESSION_SECRET", "x" * 32)
    monkeypatch.setenv("FINNOTECH_CLIENT_ID", "cid")
    monkeypatch.setenv("FINNOTECH_CLIENT_SECRET", "csec")
    monkeypatch.setenv("FINNOTECH_NATIONAL_ID", "0000000000")
    from energybot.settings import Settings
    s = Settings()
    assert s.finnotech_base_url.startswith("https://")
    assert s.finnotech_scope == "billing:cc-inquiry-detail:get"
    assert s.payment_provider == "generic"
    assert "{bill_id}" not in s.finnotech_inquiry_path or "billId" in s.finnotech_inquiry_path
