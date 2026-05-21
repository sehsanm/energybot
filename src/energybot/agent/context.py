from dataclasses import dataclass
from typing import Any
from uuid import UUID
from energybot.providers.base import ChatMessage
from energybot.profile.render import render_profile_summary
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository


@dataclass(slots=True)
class AssembledContext:
    system: str
    messages: list[ChatMessage]
    prompt_template_key: str
    prompt_template_version: int


class ContextAssembler:
    def __init__(self, *, prompt_loader: Any, profile_repo: ProfileRepository, chat_repo: ChatRepository, recent_n: int = 10):
        self._loader = prompt_loader
        self._profile_repo = profile_repo
        self._chat_repo = chat_repo
        self._recent_n = recent_n

    async def assemble(self, user_id: UUID, new_user_text: str) -> AssembledContext:
        profile = await self._profile_repo.get(user_id)
        profile_summary = render_profile_summary(
            profile.household or {}, profile.behaviour or {}, profile.goals or [], profile.commitments or [],
        )
        last_summary = await self._chat_repo.latest_summary(user_id)
        recent = await self._chat_repo.last_n_user_assistant(user_id, n=self._recent_n)
        system_text, key, version = await self._loader.render("system_prompt", {
            "profile_summary": profile_summary,
            "rolling_summary": last_summary.text if last_summary else "",
        })
        messages: list[ChatMessage] = [ChatMessage(role="system", content=system_text)]
        for m in recent:
            messages.append(ChatMessage(role=m.role, content=m.content))
        messages.append(ChatMessage(role="user", content=new_user_text))
        return AssembledContext(system=system_text, messages=messages,
                                prompt_template_key=key, prompt_template_version=version)
