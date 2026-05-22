from typing import Any, Literal, Protocol
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal["system", "user", "assistant", "tool"]
    content: str = ""
    name: str | None = None
    tool_call_id: str | None = None
    tool_calls: list[dict[str, Any]] | None = None
    # DeepSeek V4 thinking-mode replay contract: once a turn emits reasoning_content, every
    # subsequent assistant message we send back must include it or the API rejects the request.
    reasoning_content: str | None = None


class Tool(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]


class ChatRequest(BaseModel):
    model: str
    messages: list[ChatMessage]
    tools: list[Tool] | None = None
    temperature: float | None = None
    max_tokens: int | None = None
    top_p: float | None = None


class ChatResponse(BaseModel):
    content: str
    tool_calls: list[dict[str, Any]] = Field(default_factory=list)
    tokens_in: int
    tokens_out: int
    finish_reason: str
    model: str | None = None
    reasoning_content: str | None = None


class EmbeddingRequest(BaseModel):
    model: str
    inputs: list[str]


class EmbeddingResponse(BaseModel):
    vectors: list[list[float]]
    tokens_in: int


class ProviderError(Exception):
    """Retryable or non-retryable provider failure."""

    def __init__(self, message: str, *, status: int | None = None, retryable: bool = False):
        super().__init__(message)
        self.status = status
        self.retryable = retryable


class Provider(Protocol):
    name: str

    async def chat(self, req: ChatRequest) -> ChatResponse: ...
    async def embed(self, req: EmbeddingRequest) -> EmbeddingResponse: ...
