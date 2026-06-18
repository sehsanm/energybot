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

    # Finnotech billing
    finnotech_client_id: str = ""
    finnotech_client_secret: str = ""
    finnotech_national_id: str = ""  # NID the OAuth client is registered to
    finnotech_scope: str = "billing:cc-inquiry-detail:get"
    finnotech_base_url: str = "https://apibeta.finnotech.ir"
    finnotech_token_path: str = "/dev/v2/oauth2/token"
    finnotech_inquiry_path: str = "/billing/v2/clients/{client_id}/billInquiry"

    # Payment gateway (redirect)
    payment_provider: str = "generic"  # generic | finnotech
    payment_gateway_base: str = ""
    payment_merchant_id: str = ""
    payment_callback_base_url: str = ""  # public base, e.g. https://bot.example.ir

    session_secret: str = Field(..., min_length=32)
    media_root: str = "/var/lib/energybot/media"

    summary_message_threshold: int = 20
    tool_iteration_cap: int = 6
    session_idle_minutes: int = 30
    web_login_token_ttl_minutes: int = 5
    web_chat_chunk_chars: int = 3
    web_chat_chunk_delay_ms: int = 12
    user_session_days: int = 30
    public_base_url: str = ""
    soft_delete_grace_days: int = 30

    log_level: str = "INFO"


@lru_cache
def get_settings() -> Settings:
    return Settings()
