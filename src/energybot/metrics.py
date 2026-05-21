from fastapi import APIRouter, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

router = APIRouter()

webhook_requests = Counter("energybot_webhook_requests_total", "Bale webhook requests", ["status"])
llm_calls = Counter("energybot_llm_calls_total", "LLM calls", ["provider", "call_type", "status"])
agent_iterations = Histogram("energybot_agent_iterations", "Tool iterations per agent turn", buckets=(0, 1, 2, 3, 4, 5, 6))
kb_searches = Counter("energybot_kb_searches_total", "KB search tool invocations")


@router.get("/metrics")
async def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)
