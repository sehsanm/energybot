from typing import Any
from uuid import UUID
from energybot.profile.repository import ProfileRepository


class UpdateProfileTool:
    name = "update_profile"
    description = "به‌روزرسانی یک فیلد در پروفایل کاربر. مسیر مثل household.city یا behaviour.peak_usage_hours."
    parameters = {
        "type": "object",
        "properties": {
            "path": {"type": "string"},
            "value": {},
            "reason": {"type": "string"},
        },
        "required": ["path", "value", "reason"],
    }

    def __init__(self, *, repo: ProfileRepository, user_id: UUID, current_message_id: int | None):
        self._repo = repo
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        await self._repo.set(self._user_id, args["path"], args["value"],
                             source="agent_tool", reason=args["reason"],
                             source_message_id=self._msg_id)
        return {"ok": True}
