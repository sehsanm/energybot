from energybot.providers.frontier import FrontierProvider


class DeepSeekProvider(FrontierProvider):
    """DeepSeek exposes an OpenAI-compatible interface. Reuses FrontierProvider's HTTP plumbing."""
    name = "deepseek"
