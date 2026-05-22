from typing import Any
from energybot.kb.retrieval import RetrievalService


class SearchKBTool:
    name = "search_knowledge_base"
    description = "جستجو در دانش‌نامه فارسی برای یافتن محتوای مرتبط."
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "عبارت جستجو به فارسی"},
            "category": {"type": "string", "enum": ["electricity", "gas", "general"]},
            "top_k": {"type": "integer", "default": 5, "minimum": 1, "maximum": 10},
        },
        "required": ["query"],
    }

    def __init__(self, *, retrieval: RetrievalService):
        self._retrieval = retrieval

    async def invoke(self, args: dict[str, Any]) -> list[dict[str, Any]]:
        return await self._retrieval.search(
            query=args["query"], top_k=int(args.get("top_k", 5)), category=args.get("category"),
        )
