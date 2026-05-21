from typing import Any
from uuid import UUID, uuid4
from datetime import datetime
from energybot.profile.repository import ProfileRepository


class RecordCommitmentTool:
    name = "record_commitment"
    description = "ثبت تعهد جدید کاربر."
    parameters = {
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "target_date": {"type": "string", "description": "YYYY-MM-DD or null"},
        },
        "required": ["text"],
    }

    def __init__(self, *, repo: ProfileRepository, user_id: UUID, current_message_id: int | None):
        self._repo = repo
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        cid = str(uuid4())
        item = {"id": cid, "text": args["text"], "target_date": args.get("target_date"),
                "made_at": datetime.utcnow().isoformat(), "fulfilled": False}
        await self._repo.append(self._user_id, "commitments", item, source="agent_tool",
                                reason="record_commitment", source_message_id=self._msg_id)
        return {"commitment_id": cid}
