"""Single source of truth for which providers are wired up at runtime.

Keep this in sync with the `provider` column values used in `model_configs`. A provider whose
API key is unset is silently omitted — call_types that reference it will fail at call time with
a clear ProviderError, rather than crashing app startup.
"""
from energybot.providers.base import Provider
from energybot.providers.deepseek import DeepSeekProvider
from energybot.providers.frontier import FrontierProvider
from energybot.providers.metis import MetisProvider
from energybot.settings import Settings


def build_providers(s: Settings) -> dict[str, Provider]:
    providers: dict[str, Provider] = {}
    if s.frontier_api_key:
        providers["frontier"] = FrontierProvider(
            api_key=s.frontier_api_key, base_url=s.frontier_base_url, proxy_url=s.frontier_proxy_url,
        )
    if s.metis_api_key:
        providers["metis"] = MetisProvider(api_key=s.metis_api_key, base_url=s.metis_base_url)
    if s.deepseek_api_key:
        providers["deepseek"] = DeepSeekProvider(
            api_key=s.deepseek_api_key, base_url=s.deepseek_base_url, proxy_url=s.deepseek_proxy_url,
        )
    return providers
