from functools import lru_cache
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    database_url: str = Field(..., description="postgresql+asyncpg://...")
    bale_bot_token: str
    bale_webhook_secret: str
    bale_api_base: str = "https://tapi.bale.ai"
    bale_mode: str = "webhook"  # webhook | polling
    bale_poll_timeout: int = 30  # long-poll timeout (seconds), used when bale_mode='polling'

    frontier_proxy_url: str | None = None
    frontier_api_key: str
    frontier_base_url: str = "https://api.openai.com/v1"

    metis_api_key: str
    metis_base_url: str = "https://api.metisai.ir/openai/v1"

    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    deepseek_proxy_url: str | None = None

    session_secret: str = Field(..., min_length=32)
    media_root: str = "/var/lib/energybot/media"

    summary_message_threshold: int = 20
    tool_iteration_cap: int = 6
    session_idle_minutes: int = 30
    soft_delete_grace_days: int = 30

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
