from typing import Any
from uuid import UUID
from sqlalchemy import select
from energybot.chat.repository import ChatRepository
from energybot.core.models import Message


class EscalateTool:
    name = "escalate_to_human"
    description = "نشانه‌گذاری گفتگو برای بازبینی توسط ادمین. در فاز ۱ فقط پرچم می‌گذارد."
    parameters = {
        "type": "object",
        "properties": {"reason": {"type": "string"}},
        "required": ["reason"],
    }

    def __init__(self, *, chat: ChatRepository, user_id: UUID, current_message_id: int):
        self._chat = chat
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        s = self._chat._session_factory()
        m = (await s.execute(select(Message).where(Message.id == self._msg_id))).scalar_one()
        m.meta = {**(m.meta or {}), "flagged": True, "escalate_reason": args["reason"]}
        await s.commit()
        return {"ok": True}
