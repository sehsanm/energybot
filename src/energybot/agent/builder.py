from uuid import UUID
from collections.abc import Callable
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.settings import get_settings
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
from energybot.agent.tools.read_bills import ReadBillsTool
from energybot.agent.tools.suggest_actions import SuggestActionsTool
from energybot.agent.result import AgentResult
from energybot.billing.repository import BillingRepository
from energybot.chat.repository import ChatRepository
from energybot.memory.repository import MemoryRepository
from energybot.agent.tools.manage_memory import ManageMemoryTool
from energybot.profile.repository import ProfileRepository
from energybot.kb.retrieval import RetrievalService
from energybot.providers.factory import build_providers
from energybot.providers.router import ProviderRouter


def build_agent(*, user_id: UUID, channel, session_factory: Callable[[], AsyncSession]):
    s = get_settings()
    router = ProviderRouter(providers=build_providers(s), session_factory=session_factory)
    chat_repo = ChatRepository(session_factory=session_factory, idle_minutes=s.session_idle_minutes)
    profile_repo = ProfileRepository(session_factory=session_factory)
    memory_repo = MemoryRepository(session_factory=session_factory)
    loader = PromptLoader(session_factory=session_factory)
    asm = ContextAssembler(prompt_loader=loader, profile_repo=profile_repo, chat_repo=chat_repo, memory_repo=memory_repo)
    retrieval = RetrievalService(router=router, session_factory=session_factory)
    registry = ToolRegistry()
    registry.register(ReadProfileTool(repo=profile_repo, user_id=user_id))
    registry.register(UpdateProfileTool(repo=profile_repo, user_id=user_id, current_message_id=None))
    registry.register(RecordCommitmentTool(repo=profile_repo, user_id=user_id, current_message_id=None))
    registry.register(ManageMemoryTool(repo=memory_repo, user_id=user_id, current_message_id=None))
    registry.register(SearchKBTool(retrieval=retrieval))
    registry.register(SendKBMediaTool(channel=channel, session_factory=session_factory))
    registry.register(ReadBillsTool(repo=BillingRepository(session_factory=session_factory), user_id=user_id))
    suggest_tool = SuggestActionsTool()
    registry.register(suggest_tool)

    class _Adapter:
        async def handle(self_inner, text: str) -> AgentResult:
            suggest_tool.reset()
            summ = Summarizer(chat_repo=chat_repo, router=router, threshold=s.summary_message_threshold)
            loop = AgentLoop(
                router=router, context_assembler=asm, chat_repo=chat_repo,
                tool_registry=registry, summarizer=summ,
                tool_iteration_cap=s.tool_iteration_cap, user_id=user_id,
            )
            text_out = await loop.handle_message(text)
            return AgentResult(text=text_out, suggestions=list(suggest_tool.selected))

    return _Adapter()
