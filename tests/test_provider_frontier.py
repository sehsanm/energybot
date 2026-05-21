import httpx
import pytest
from energybot.providers.base import ChatMessage, ChatRequest, EmbeddingRequest, ProviderError
from energybot.providers.frontier import FrontierProvider


def _mock_transport(handler):
    return httpx.MockTransport(handler)


@pytest.mark.asyncio
async def test_chat_happy_path():
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/chat/completions")
        return httpx.Response(200, json={
            "choices": [{
                "message": {"role": "assistant", "content": "سلام", "tool_calls": None},
                "finish_reason": "stop",
            }],
            "usage": {"prompt_tokens": 5, "completion_tokens": 2},
            "model": "gpt-4o-mini",
        })

    p = FrontierProvider(
        api_key="k", base_url="https://api.openai.com/v1",
        transport=_mock_transport(handler),
    )
    r = await p.chat(ChatRequest(model="gpt-4o-mini", messages=[ChatMessage(role="user", content="hi")]))
    assert r.content == "سلام"
    assert r.tokens_in == 5
    assert r.tokens_out == 2
    assert r.finish_reason == "stop"


@pytest.mark.asyncio
async def test_chat_5xx_raises_retryable():
    def handler(request):
        return httpx.Response(503, text="upstream busy")
    p = FrontierProvider(api_key="k", base_url="https://x/v1", transport=_mock_transport(handler))
    with pytest.raises(ProviderError) as ei:
        await p.chat(ChatRequest(model="m", messages=[ChatMessage(role="user", content="hi")]))
    assert ei.value.retryable is True


@pytest.mark.asyncio
async def test_embed_happy_path():
    def handler(request):
        return httpx.Response(200, json={
            "data": [{"embedding": [0.1] * 1536}, {"embedding": [0.2] * 1536}],
            "usage": {"prompt_tokens": 6},
            "model": "text-embedding-3-small",
        })
    p = FrontierProvider(api_key="k", base_url="https://x/v1", transport=_mock_transport(handler))
    r = await p.embed(EmbeddingRequest(model="text-embedding-3-small", inputs=["a", "b"]))
    assert len(r.vectors) == 2
    assert len(r.vectors[0]) == 1536
    assert r.tokens_in == 6
