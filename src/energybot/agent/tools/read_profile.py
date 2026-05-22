from typing import Any
from uuid import UUID
from energybot.profile.repository import ProfileRepository


class ReadProfileTool:
    name = "read_profile"
    description = "خواندن نمای کامل پروفایل کاربر فعلی."
    parameters = {"type": "object", "properties": {}}

    def __init__(self, *, repo: ProfileRepository, user_id: UUID):
        self._repo = repo
        self._user_id = user_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        p = await self._repo.get(self._user_id)
        return {
            "household": p.household, "behaviour": p.behaviour,
            "goals": p.goals, "commitments": p.commitments,
            "completeness_score": p.completeness_score,
        }
