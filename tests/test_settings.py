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
