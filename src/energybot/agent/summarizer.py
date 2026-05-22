from typing import Any
from uuid import UUID
from energybot.chat.repository import ChatRepository
from energybot.providers.base import ChatMessage, ChatRequest


SUMMARIZER_SYSTEM = (
    "تو یک خلاصه‌نویس فارسی هستی. خلاصه‌ای فشرده (یک تا دو پاراگراف) از گفتگو بنویس "
    "که شامل: موضوعات اصلی، تصمیم‌ها، تعهدها، و حقایق مهم درباره‌ی کاربر باشد."
)


class Summarizer:
    def __init__(self, *, chat_repo: ChatRepository, router: Any, threshold: int = 20):
        self._chat_repo = chat_repo
        self._router = router
        self._threshold = threshold

    async def maybe_summarize(self, user_id: UUID) -> bool:
        last = await self._chat_repo.latest_summary(user_id)
        after_id = last.covers_to_message_id if last else 0
        new_messages = await self._chat_repo.messages_since(user_id, after_id)
        if len(new_messages) < self._threshold:
            return False
        transcript_lines: list[str] = []
        for m in new_messages:
            if m.role in ("user", "assistant") and m.content:
                speaker = "کاربر" if m.role == "user" else "دستیار"
                transcript_lines.append(f"{speaker}: {m.content}")
        prior_block = f"خلاصه قبلی: {last.text}\n\n" if last else ""
        req = ChatRequest(
            model="",
            messages=[
                ChatMessage(role="system", content=SUMMARIZER_SYSTEM),
                ChatMessage(role="user", content=prior_block + "گفتگوی جدید:\n" + "\n".join(transcript_lines)),
            ],
        )
        resp = await self._router.chat(call_type="summarize", req=req)
        from energybot.core.models import ChatSummary
        s = self._chat_repo._session_factory()
        s.add(ChatSummary(
            user_id=user_id, session_id=None, text=resp.content,
            covers_from_message_id=new_messages[0].id, covers_to_message_id=new_messages[-1].id,
        ))
        await s.commit()
        return True
