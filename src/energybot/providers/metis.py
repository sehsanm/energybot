from energybot.providers.frontier import FrontierProvider


class MetisProvider(FrontierProvider):
    """Metis exposes an OpenAI-compatible interface. Reuses FrontierProvider's HTTP plumbing."""
    name = "metis"
