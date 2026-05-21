import httpx
import pytest
from energybot.providers.base import ChatMessage, ChatRequest
from energybot.providers.metis import MetisProvider


@pytest.mark.asyncio
async def test_metis_uses_iranian_base_url():
    captured: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={
            "choices": [{"message": {"role": "assistant", "content": "تست", "tool_calls": None}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 1, "completion_tokens": 1},
            "model": "metis-chat-pro",
        })

    p = MetisProvider(api_key="k", base_url="https://api.metisai.ir/openai/v1", transport=httpx.MockTransport(handler))
    r = await p.chat(ChatRequest(model="metis-chat-pro", messages=[ChatMessage(role="user", content="hi")]))
    assert "api.metisai.ir" in captured["url"]
    assert r.content == "تست"
