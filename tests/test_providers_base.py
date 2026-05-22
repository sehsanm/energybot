from energybot.providers.base import ChatMessage, ChatRequest, ChatResponse, EmbeddingRequest, EmbeddingResponse, Tool


def test_chat_request_minimal():
    req = ChatRequest(model="gpt-4o-mini", messages=[ChatMessage(role="user", content="hi")])
    assert req.temperature is None
    assert req.tools is None


def test_tool_schema():
    t = Tool(name="x", description="d", parameters={"type": "object", "properties": {}})
    assert t.name == "x"


def test_chat_response_with_tool_calls():
    r = ChatResponse(
        content="",
        tool_calls=[{"id": "t1", "name": "search_kb", "arguments": {"query": "بخاری"}}],
        tokens_in=10,
        tokens_out=5,
        finish_reason="tool_calls",
    )
    assert r.tool_calls[0]["name"] == "search_kb"


def test_embedding_response_dims():
    e = EmbeddingResponse(vectors=[[0.1] * 1536], tokens_in=4)
    assert len(e.vectors[0]) == 1536
