from typing import Any
from energybot.bale_adapter.actions import CATALOG_KEYS


class SuggestActionsTool:
    name = "suggest_actions"
    description = (
        "در پایان پاسخ، ۰ تا ۳ دکمهٔ اقدام مرتبط به کاربر پیشنهاد بده. "
        "فقط وقتی استفاده کن که اقدام بعدی مشخصی برای کاربر وجود دارد."
    )
    parameters = {
        "type": "object",
        "properties": {
            "actions": {
                "type": "array",
                "items": {"type": "string", "enum": CATALOG_KEYS},
                "maxItems": 3,
            }
        },
        "required": ["actions"],
    }

    def __init__(self) -> None:
        self.selected: list[str] = []

    def reset(self) -> None:
        self.selected = []

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        keys = [k for k in (args.get("actions") or []) if k in CATALOG_KEYS][:3]
        self.selected = keys
        return {"accepted": keys}
