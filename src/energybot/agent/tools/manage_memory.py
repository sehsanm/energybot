from typing import Any
from uuid import UUID
from energybot.memory.repository import MemoryRepository, VALID_CATEGORIES

MEMORY_SOFT_CAP = 40

_CAP_NOTE = (
    f"حافظه‌ی کاربر به سقف توصیه‌شده (~{MEMORY_SOFT_CAP} مورد) نزدیک شده؛ "
    "موارد تکراری یا قدیمی را با action=remove یا update تجمیع/پاک‌سازی کن."
)


class ManageMemoryTool:
    name = "manage_memory"
    description = (
        "مدیریت حافظه‌ی بلندمدت درباره‌ی کاربر: نکات غیرساختاریافته مثل ترجیحات، "
        "شرایط زندگی، محدودیت‌ها و سبک تعامل. برای افزودن نکته‌ی جدید action=add، "
        "برای اصلاح action=update و برای حذف action=remove را بزن. "
        "اطلاعات ساختاریافته‌ی خانه/اهداف/تعهدها را اینجا ذخیره نکن؛ آن‌ها را با "
        "update_profile و record_commitment ثبت کن."
    )
    parameters = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["add", "update", "remove"]},
            "text": {"type": "string", "description": "متن نکته (برای add لازم است)"},
            "category": {"type": "string", "enum": sorted(VALID_CATEGORIES)},
            "memory_id": {"type": "integer", "description": "شناسه‌ی نکته (برای update/remove لازم است)"},
        },
        "required": ["action"],
    }

    def __init__(self, *, repo: MemoryRepository, user_id: UUID, current_message_id: int | None):
        self._repo = repo
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        action = args.get("action")
        if action == "add":
            text = args.get("text")
            category = args.get("category")
            if not text or not category:
                raise ValueError("action=add requires both text and category")
            at_cap = await self._repo.count_active(self._user_id) >= MEMORY_SOFT_CAP
            row = await self._repo.add(self._user_id, text, category,
                                       source_message_id=self._msg_id)
            out: dict[str, Any] = {"memory_id": row.id}
            if at_cap:
                out["note"] = _CAP_NOTE
            return out
        if action == "update":
            memory_id = args.get("memory_id")
            if memory_id is None:
                raise ValueError("action=update requires memory_id")
            if args.get("text") is None and args.get("category") is None:
                raise ValueError("action=update requires text and/or category")
            row = await self._repo.update(self._user_id, memory_id,
                                          text=args.get("text"), category=args.get("category"))
            return {"memory_id": row.id}
        if action == "remove":
            memory_id = args.get("memory_id")
            if memory_id is None:
                raise ValueError("action=remove requires memory_id")
            await self._repo.remove(self._user_id, memory_id)
            return {"ok": True}
        raise ValueError(f"unknown action: {action!r}")
