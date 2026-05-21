from typing import Any, Protocol
from energybot.providers.base import Tool


class AgentTool(Protocol):
    name: str
    description: str
    parameters: dict[str, Any]

    async def invoke(self, args: dict[str, Any]) -> Any: ...


def to_provider_tool(t: AgentTool) -> Tool:
    return Tool(name=t.name, description=t.description, parameters=t.parameters)


class ToolRegistry:
    def __init__(self) -> None:
        self._tools: dict[str, AgentTool] = {}

    def register(self, tool: AgentTool) -> None:
        self._tools[tool.name] = tool

    def get(self, name: str) -> AgentTool:
        return self._tools[name]

    def all(self) -> list[AgentTool]:
        return list(self._tools.values())
