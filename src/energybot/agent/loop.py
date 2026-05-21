import json
from uuid import UUID
from energybot.agent.context import ContextAssembler
from energybot.agent.tools.base import ToolRegistry, to_provider_tool
from energybot.chat.repository import ChatRepository
from energybot.providers.base import ChatMessage, ChatRequest


class AgentLoop:
    def __init__(self, *, router, context_assembler: ContextAssembler, chat_repo: ChatRepository,
                 tool_registry: ToolRegistry, summarizer, tool_iteration_cap: int,
                 user_id: UUID, chat_id: int):
        self._router = router
        self._asm = context_assembler
        self._chat = chat_repo
        self._tools = tool_registry
        self._summ = summarizer
        self._cap = tool_iteration_cap
        self._user_id = user_id
        self._chat_id = chat_id

    async def handle_message(self, user_text: str) -> str:
        sid = await self._chat.session_for(self._user_id)
        msg_id = await self._chat.add_message(self._user_id, sid, role="user", content=user_text)
        ctx = await self._asm.assemble(self._user_id, user_text)

        provider_tools = [to_provider_tool(t) for t in self._tools.all()] or None
        messages = list(ctx.messages)
        iters = 0
        final: str | None = None
        while True:
            req = ChatRequest(model="", messages=messages, tools=provider_tools if iters < self._cap else None)
            resp = await self._router.chat(call_type="chat_reasoning", req=req,
                                           prompt_key=ctx.prompt_template_key,
                                           prompt_version=ctx.prompt_template_version)
            if resp.tool_calls and iters < self._cap:
                messages.append(ChatMessage(role="assistant", content=resp.content or "", tool_calls=resp.tool_calls))
                for tc in resp.tool_calls:
                    name = tc["function"]["name"] if "function" in tc else tc.get("name", "")
                    raw_args = tc["function"]["arguments"] if "function" in tc else tc.get("arguments", "{}")
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                    tool = self._tools.get(name)
                    try:
                        result = await tool.invoke(args)
                        result_payload = {"ok": True, "data": result}
                    except Exception as e:
                        result_payload = {"ok": False, "error": str(e)}
                    await self._chat.add_message(self._user_id, sid, role="tool",
                                                 content=json.dumps(result_payload, ensure_ascii=False),
                                                 tool_name=name, tool_args=args, tool_result=result_payload)
                    messages.append(ChatMessage(role="tool", content=json.dumps(result_payload, ensure_ascii=False),
                                                tool_call_id=tc.get("id"), name=name))
                iters += 1
                continue
            final = resp.content or ""
            await self._chat.add_message(self._user_id, sid, role="assistant", content=final,
                                         tokens_in=resp.tokens_in, tokens_out=resp.tokens_out,
                                         model_used=resp.model)
            break

        if self._summ is not None:
            await self._summ.maybe_summarize(self._user_id)
        return final or ""
