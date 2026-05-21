from typing import Any
import httpx
from energybot.providers.base import (
    ChatMessage, ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse, ProviderError, Tool,
)


def _to_openai_messages(msgs: list[ChatMessage]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in msgs:
        d: dict[str, Any] = {"role": m.role, "content": m.content}
        if m.name:
            d["name"] = m.name
        if m.tool_call_id:
            d["tool_call_id"] = m.tool_call_id
        if m.tool_calls:
            d["tool_calls"] = m.tool_calls
        out.append(d)
    return out


def _to_openai_tools(tools: list[Tool] | None) -> list[dict[str, Any]] | None:
    if not tools:
        return None
    return [{"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.parameters}} for t in tools]


class FrontierProvider:
    name = "frontier"

    def __init__(self, *, api_key: str, base_url: str, proxy_url: str | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            timeout=httpx.Timeout(60.0, connect=10.0),
            proxy=proxy_url,
            transport=transport,
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}

    async def chat(self, req: ChatRequest) -> ChatResponse:
        body: dict[str, Any] = {
            "model": req.model,
            "messages": _to_openai_messages(req.messages),
        }
        if req.tools:
            body["tools"] = _to_openai_tools(req.tools)
        if req.temperature is not None:
            body["temperature"] = req.temperature
        if req.max_tokens is not None:
            body["max_tokens"] = req.max_tokens
        if req.top_p is not None:
            body["top_p"] = req.top_p
        try:
            r = await self._client.post(f"{self._base_url}/chat/completions", headers=self._headers(), json=body)
        except httpx.HTTPError as e:
            raise ProviderError(str(e), retryable=True) from e
        if r.status_code >= 500:
            raise ProviderError(r.text, status=r.status_code, retryable=True)
        if r.status_code == 429:
            raise ProviderError(r.text, status=r.status_code, retryable=True)
        if r.status_code >= 400:
            raise ProviderError(r.text, status=r.status_code, retryable=False)
        data = r.json()
        choice = data["choices"][0]
        msg = choice["message"]
        usage = data.get("usage", {})
        return ChatResponse(
            content=msg.get("content") or "",
            tool_calls=msg.get("tool_calls") or [],
            tokens_in=usage.get("prompt_tokens", 0),
            tokens_out=usage.get("completion_tokens", 0),
            finish_reason=choice.get("finish_reason", "stop"),
            model=data.get("model"),
        )

    async def embed(self, req: EmbeddingRequest) -> EmbeddingResponse:
        body = {"model": req.model, "input": req.inputs}
        try:
            r = await self._client.post(f"{self._base_url}/embeddings", headers=self._headers(), json=body)
        except httpx.HTTPError as e:
            raise ProviderError(str(e), retryable=True) from e
        if r.status_code >= 500 or r.status_code == 429:
            raise ProviderError(r.text, status=r.status_code, retryable=True)
        if r.status_code >= 400:
            raise ProviderError(r.text, status=r.status_code, retryable=False)
        data = r.json()
        return EmbeddingResponse(
            vectors=[d["embedding"] for d in data["data"]],
            tokens_in=data.get("usage", {}).get("prompt_tokens", 0),
        )
