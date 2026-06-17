from typing import Any
from uuid import UUID
from energybot.billing.repository import BillingRepository


class ReadBillsTool:
    name = "read_bills"
    description = "خواندن قبض‌های اخیر کاربر و روند مصرف (برق/گاز) برای تحلیل و توصیه."
    parameters = {"type": "object", "properties": {}}

    def __init__(self, *, repo: BillingRepository, user_id: UUID):
        self._repo = repo
        self._user_id = user_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        bills = await self._repo.recent_bills(self._user_id, limit=24)
        items = [{
            "utility_type": b.utility_type, "amount": int(b.amount), "term": b.term,
            "status": b.status, "inquired_at": b.inquired_at.isoformat(),
        } for b in bills]
        trend: dict[str, Any] = {}
        for kind in ("electricity", "gas"):
            kind_bills = [b for b in bills if b.utility_type == kind]  # newest first
            if not kind_bills:
                continue
            latest = int(kind_bills[0].amount)
            prev = int(kind_bills[1].amount) if len(kind_bills) > 1 else None
            trend[kind] = {"latest": latest, "previous": prev,
                           "delta": (latest - prev) if prev is not None else None}
        return {"bills": items, "trend": trend}
