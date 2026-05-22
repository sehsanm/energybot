from collections.abc import Callable
from typing import Any
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.bale_adapter.client import BaleClient
from energybot.bale_adapter.commands import is_command, is_wizard_answer
from energybot.bale_adapter.parser import parse_update, UpdateText, UpdateCallback, UpdateUnknown
from energybot.core.models import User, Profile
from energybot.profile.repository import ProfileRepository
from energybot.profile.wizard import WizardEngine
from energybot.settings import get_settings


_bale_singleton: BaleClient | None = None


def get_bale_client() -> BaleClient:
    global _bale_singleton
    if _bale_singleton is None:
        s = get_settings()
        _bale_singleton = BaleClient(token=s.bale_bot_token, base_url=s.bale_api_base)
    return _bale_singleton


def build_agent_for_user(user_id, chat_id, session_factory):
    # Late import to avoid circulars; constructs everything per turn.
    from energybot.agent.context import ContextAssembler
    from energybot.agent.loop import AgentLoop
    from energybot.agent.prompts import PromptLoader
    from energybot.agent.summarizer import Summarizer
    from energybot.agent.tools.base import ToolRegistry
    from energybot.agent.tools.read_profile import ReadProfileTool
    from energybot.agent.tools.update_profile import UpdateProfileTool
    from energybot.agent.tools.record_commitment import RecordCommitmentTool
    from energybot.agent.tools.search_kb import SearchKBTool
    from energybot.agent.tools.send_kb_media import SendKBMediaTool
    from energybot.chat.repository import ChatRepository
    from energybot.kb.retrieval import RetrievalService
    from energybot.providers.factory import build_providers
    from energybot.providers.router import ProviderRouter

    s = get_settings()
    router = ProviderRouter(providers=build_providers(s), session_factory=session_factory)
    chat_repo = ChatRepository(session_factory=session_factory, idle_minutes=s.session_idle_minutes)
    profile_repo = ProfileRepository(session_factory=session_factory)
    loader = PromptLoader(session_factory=session_factory)
    asm = ContextAssembler(prompt_loader=loader, profile_repo=profile_repo, chat_repo=chat_repo)
    retrieval = RetrievalService(router=router, session_factory=session_factory)
    registry = ToolRegistry()
    registry.register(ReadProfileTool(repo=profile_repo, user_id=user_id))
    registry.register(UpdateProfileTool(repo=profile_repo, user_id=user_id, current_message_id=None))
    registry.register(RecordCommitmentTool(repo=profile_repo, user_id=user_id, current_message_id=None))
    registry.register(SearchKBTool(retrieval=retrieval))
    registry.register(SendKBMediaTool(bale=get_bale_client(), session_factory=session_factory, chat_id=chat_id))

    class _Adapter:
        async def handle(self_inner, user_id, chat_id, text):
            summ = Summarizer(chat_repo=chat_repo, router=router, threshold=s.summary_message_threshold)
            loop = AgentLoop(
                router=router, context_assembler=asm, chat_repo=chat_repo,
                tool_registry=registry, summarizer=summ,
                tool_iteration_cap=s.tool_iteration_cap,
                user_id=user_id, chat_id=chat_id,
            )
            return await loop.handle_message(text)

    return _Adapter()


async def _ensure_user_and_profile(session: AsyncSession, bale_user_id: int, display_name: str | None) -> User:
    u = (await session.execute(select(User).where(User.bale_user_id == bale_user_id))).scalar_one_or_none()
    if u is None:
        u = User(bale_user_id=bale_user_id, display_name=display_name)
        session.add(u)
        await session.flush()
        session.add(Profile(user_id=u.id))
        await session.commit()
    return u


async def handle_bale_update(body: dict[str, Any], *, session_factory: Callable[[], AsyncSession]) -> None:
    parsed = parse_update(body)
    if isinstance(parsed, UpdateUnknown):
        return
    session = session_factory()
    user = await _ensure_user_and_profile(session, parsed.bale_user_id, getattr(parsed, "display_name", None))
    bale = get_bale_client()
    await bale.send_chat_action(chat_id=parsed.chat_id, action="typing")

    profile_repo = ProfileRepository(session_factory=session_factory)
    wizard = WizardEngine(session_factory=session_factory, profile_repo=profile_repo)

    if isinstance(parsed, UpdateText):
        text = parsed.text.strip()
        if text == "/start":
            step = await wizard.start(user.id)
            await _send_step(bale, parsed.chat_id, step)
            return
        if text == "/help":
            await bale.send_message(chat_id=parsed.chat_id, text="من یک دستیار صرفه‌جویی انرژی هستم. /profile برای دیدن پروفایل، /forget برای فراموش‌کردن من، /restart برای شروع گفتگوی تازه.")
            return
        if text == "/profile":
            from energybot.profile.render import render_profile_summary
            p = await profile_repo.get(user.id)
            summary = render_profile_summary(p.household or {}, p.behaviour or {}, p.goals or [], p.commitments or [])
            await bale.send_message(chat_id=parsed.chat_id, text=summary)
            return
        if text == "/restart":
            await bale.send_message(chat_id=parsed.chat_id, text="گفتگوی تازه آغاز شد. در چه موردی صحبت کنیم؟")
            return
        if text == "/forget":
            from datetime import datetime
            user.deleted_at = datetime.utcnow()
            user.display_name = "[deleted]"
            p = await profile_repo.get(user.id)
            p.deleted_at = datetime.utcnow()
            await session.commit()
            await bale.send_message(chat_id=parsed.chat_id, text="باشد، اطلاعات شما حذف شد.")
            return

        current = await wizard.current_step(user.id)
        if current is not None:
            if is_wizard_answer(text):
                next_step = await wizard.answer(user.id, text)
                if next_step is None:
                    await bale.send_message(chat_id=parsed.chat_id, text="ممنون! حالا می‌توانم بهت کمک کنم. در چه موردی می‌خواهی صحبت کنیم؟")
                    return
                await _send_step(bale, parsed.chat_id, next_step)
                return
            else:
                await wizard.abandon(user.id)

        try:
            agent = build_agent_for_user(user.id, parsed.chat_id, session_factory)
            reply = await agent.handle(user.id, parsed.chat_id, text)
        except Exception:
            from energybot.logging import get_logger
            get_logger(__name__).exception("agent_call_failed", user_id=str(user.id), chat_id=parsed.chat_id)
            reply = "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"
        await bale.send_message(chat_id=parsed.chat_id, text=reply)

    elif isinstance(parsed, UpdateCallback):
        await bale.answer_callback_query(callback_query_id=parsed.callback_id)
        current = await wizard.current_step(user.id)
        if current is not None:
            next_step = await wizard.answer(user.id, parsed.data)
            if next_step is None:
                await bale.send_message(chat_id=parsed.chat_id, text="ممنون! حالا می‌توانم بهت کمک کنم. در چه موردی صحبت کنیم؟")
            else:
                await _send_step(bale, parsed.chat_id, next_step)


async def _send_step(bale: BaleClient, chat_id: int, step) -> None:
    markup = None
    if step.buttons:
        markup = {"inline_keyboard": [[{"text": b, "callback_data": b}] for b in step.buttons]}
    await bale.send_message(chat_id=chat_id, text=step.prompt, reply_markup=markup)
