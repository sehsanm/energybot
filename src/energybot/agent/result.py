from dataclasses import dataclass, field


@dataclass(slots=True)
class AgentResult:
    text: str
    suggestions: list[str] = field(default_factory=list)
