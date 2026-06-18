# User Web Platform — Stage 2 (Unified Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the existing energy-assistant agent in the user web app as a unified chat: one channel-agnostic agent, an SSE pseudo-streaming `POST /api/app/chat`, KB media served to the browser, conversation history, and an `/app/chat` screen.

**Architecture:** Introduce a `ResponseChannel` abstraction so the same `AgentLoop` drives Bale (`BaleChannel`) and web (`WebChannel`); extract the per-turn agent construction into `agent/builder.py`. The web chat endpoint runs the agent to completion with a `WebChannel`, then streams the answer as SSE chunks (typewriter) after any buffered media events. Bale behavior is unchanged and regression-guarded.

**Tech Stack:** Python + FastAPI (StreamingResponse/FileResponse) + SQLAlchemy async + Postgres; Next.js static export + React (fetch + ReadableStream for SSE); pytest unit + Postgres integration.

## Global Constraints

- Persian-only (`fa`), RTL frontend. Exact fallback copy: `متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟`; thinking status: `در حال فکر کردن…`.
- The Bale bot's behavior must not change; the channel refactor is regression-guarded (`BaleChannel` reproduces the exact `send_photo`/`send_video` calls + `bale_file_id` caching).
- All new endpoints live under `/api/app/*` and are gated by `current_user` (from `src/energybot/user_api/auth.py`).
- Pseudo-streaming only (providers unchanged). SSE event contract: `status → media* → chunk* → done`, or `error` on failure.
- Reuse existing services (`ChatRepository`, `build_providers`, `ProviderRouter`, KB retrieval). New backend code for chat lives in `src/energybot/user_api/chat.py`; channel/builder code under `src/energybot/agent/`.
- venv at `.venv/`; test Postgres: `postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test` (run integration tests with `TEST_DATABASE_URL` set; ensure `docker compose -f docker-compose.test.yml up -d`).

**Reference spec:** `docs/superpowers/specs/2026-06-18-user-web-platform-stage2-chat-design.md`

---

## File Structure

- `src/energybot/agent/channels.py` — `ResponseChannel`, `BaleChannel`, `WebChannel` (create).
- `src/energybot/agent/tools/send_kb_media.py` — refactor to take a `channel` (modify).
- `src/energybot/agent/builder.py` — channel-agnostic `build_agent(...)` (create).
- `src/energybot/agent/loop.py` — drop unused `chat_id` (modify).
- `src/energybot/bale_adapter/handler.py` — `build_agent_for_user` → thin wrapper; update agent call site (modify).
- `src/energybot/chat/repository.py` — `history_page`, `latest_assistant_message_id` (modify).
- `src/energybot/user_api/chat.py` — `POST /chat` (SSE), `GET /chat/history`, `GET /media/{id}` (create).
- `src/energybot/main.py` — include the chat router (modify).
- `src/energybot/settings.py` — `web_chat_chunk_chars`, `web_chat_chunk_delay_ms` (modify).
- `app_ui/src/lib/api.ts` — `streamChat`, `getHistory` (modify).
- `app_ui/src/app/chat/page.tsx` — chat screen (create).
- Tests: `tests/test_agent_channels.py`, `tests/integration/test_agent_builder.py`, `tests/integration/test_chat_history.py`, `tests/integration/test_user_media.py`, `tests/integration/test_user_chat_sse.py` (create).

---

### Task 1: ResponseChannel abstraction + SendKBMediaTool refactor

**Files:**
- Create: `src/energybot/agent/channels.py`
- Modify: `src/energybot/agent/tools/send_kb_media.py`
- Modify: `src/energybot/bale_adapter/handler.py` (the `SendKBMediaTool(...)` registration in `build_agent_for_user`)
- Test: `tests/test_agent_channels.py`

**Interfaces:**
- Produces:
  - `class BaleChannel:` `__init__(self, bale, chat_id: int)`, `async def send_media(self, attachment, caption: str | None) -> None`
  - `class WebChannel:` `__init__(self)`, attribute `events: list[dict]`, `async def send_media(self, attachment, caption: str | None) -> None`
  - `SendKBMediaTool(*, channel, session_factory)` — constructor now takes `channel` (no `bale`/`chat_id`).
- Consumes: `core.models.KBAttachment`.

- [ ] **Step 1: Write the failing tests**

Create `tests/test_agent_channels.py`:

```python
import pytest
from types import SimpleNamespace
from uuid import uuid4
from energybot.agent.channels import BaleChannel, WebChannel


class _FakeBale:
    def __init__(self):
        self.photo_calls = []
        self.video_calls = []

    async def send_photo(self, *, chat_id, file_id, file_path, caption):
        self.photo_calls.append(dict(chat_id=chat_id, file_id=file_id, file_path=file_path, caption=caption))
        return "new-file-id"

    async def send_video(self, *, chat_id, file_id, file_path, caption):
        self.video_calls.append(dict(chat_id=chat_id, file_id=file_id, file_path=file_path, caption=caption))
        return "new-file-id"


def _att(**kw):
    base = dict(id=uuid4(), type="image", storage_path="/tmp/x.png", bale_file_id=None)
    base.update(kw)
    return SimpleNamespace(**base)


@pytest.mark.asyncio
async def test_bale_channel_image_uses_storage_path_and_caches_file_id():
    bale = _FakeBale()
    att = _att(type="image", bale_file_id=None)
    await BaleChannel(bale, 555).send_media(att, "کپشن")
    assert bale.photo_calls == [dict(chat_id=555, file_id=None, file_path="/tmp/x.png", caption="کپشن")]
    assert att.bale_file_id == "new-file-id"  # cached back


@pytest.mark.asyncio
async def test_bale_channel_video_with_existing_file_id_skips_path():
    bale = _FakeBale()
    att = _att(type="video", storage_path="/tmp/v.mp4", bale_file_id="cached")
    await BaleChannel(bale, 9).send_media(att, None)
    assert bale.video_calls == [dict(chat_id=9, file_id="cached", file_path=None, caption=None)]
    assert att.bale_file_id == "cached"  # unchanged


@pytest.mark.asyncio
async def test_web_channel_buffers_media_event():
    att = _att(type="image")
    web = WebChannel()
    await web.send_media(att, "کپشن")
    assert web.events == [{
        "type": "media", "attachment_id": str(att.id), "media_type": "image",
        "url": f"/api/app/media/{att.id}", "caption": "کپشن",
    }]
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_agent_channels.py -v`
Expected: FAIL (`ModuleNotFoundError: energybot.agent.channels`).

- [ ] **Step 3: Create channels.py**

Create `src/energybot/agent/channels.py`:

```python
from typing import Any, Protocol
from energybot.core.models import KBAttachment


class ResponseChannel(Protocol):
    async def send_media(self, attachment: KBAttachment, caption: str | None) -> None: ...


class BaleChannel:
    def __init__(self, bale, chat_id: int):
        self._bale = bale
        self._chat_id = chat_id

    async def send_media(self, attachment: KBAttachment, caption: str | None) -> None:
        file_path = attachment.storage_path if not attachment.bale_file_id else None
        if attachment.type == "image":
            returned = await self._bale.send_photo(
                chat_id=self._chat_id, file_id=attachment.bale_file_id,
                file_path=file_path, caption=caption,
            )
        else:
            returned = await self._bale.send_video(
                chat_id=self._chat_id, file_id=attachment.bale_file_id,
                file_path=file_path, caption=caption,
            )
        if returned and not attachment.bale_file_id:
            attachment.bale_file_id = returned


class WebChannel:
    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    async def send_media(self, attachment: KBAttachment, caption: str | None) -> None:
        self.events.append({
            "type": "media",
            "attachment_id": str(attachment.id),
            "media_type": attachment.type,
            "url": f"/api/app/media/{attachment.id}",
            "caption": caption,
        })
```

- [ ] **Step 4: Run to verify pass**

Run: `.venv/bin/pytest tests/test_agent_channels.py -v`
Expected: 3 passed.

- [ ] **Step 5: Refactor SendKBMediaTool to use the channel**

Replace `src/energybot/agent/tools/send_kb_media.py` with:

```python
from collections.abc import Callable
from typing import Any
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import KBAttachment


class SendKBMediaTool:
    name = "send_kb_media"
    description = "ارسال تصویر یا ویدیوی پیوست‌شده به یک مقاله."
    parameters = {
        "type": "object",
        "properties": {
            "attachment_id": {"type": "string"},
            "caption": {"type": "string"},
        },
        "required": ["attachment_id"],
    }

    def __init__(self, *, channel, session_factory: Callable[[], AsyncSession]):
        self._channel = channel
        self._session_factory = session_factory

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        att_id = UUID(args["attachment_id"])
        s = self._session_factory()
        att = (await s.execute(
            select(KBAttachment).where(KBAttachment.id == att_id, KBAttachment.deleted_at.is_(None))
        )).scalar_one()
        caption = args.get("caption") or att.caption_fa
        await self._channel.send_media(att, caption)
        await s.commit()
        return {"ok": True}
```

- [ ] **Step 6: Update the Bale construction site**

In `src/energybot/bale_adapter/handler.py`, inside `build_agent_for_user`, change the import block to add the channel import and replace the `SendKBMediaTool` registration. Find:

```python
    registry.register(SendKBMediaTool(bale=get_bale_client(), session_factory=session_factory, chat_id=chat_id))
```

Replace with:

```python
    from energybot.agent.channels import BaleChannel
    registry.register(SendKBMediaTool(channel=BaleChannel(get_bale_client(), chat_id), session_factory=session_factory))
```

- [ ] **Step 7: Run the full unit suite (Bale regression)**

Run: `.venv/bin/pytest -m "not llm" -q`
Expected: all pass (the existing Bale/agent tests still green; `tests/test_agent_channels.py` included).

- [ ] **Step 8: Commit**

```bash
git add src/energybot/agent/channels.py src/energybot/agent/tools/send_kb_media.py src/energybot/bale_adapter/handler.py tests/test_agent_channels.py
git commit -m "feat(agent): ResponseChannel abstraction; SendKBMediaTool via channel"
```

---

### Task 2: Extract channel-agnostic build_agent; drop unused chat_id from AgentLoop

**Files:**
- Create: `src/energybot/agent/builder.py`
- Modify: `src/energybot/agent/loop.py` (remove `chat_id` ctor param + field)
- Modify: `src/energybot/bale_adapter/handler.py` (`build_agent_for_user` → wrapper; update the `agent.handle(...)` call site)
- Test: `tests/integration/test_agent_builder.py`

**Interfaces:**
- Consumes: `BaleChannel`, `WebChannel` (Task 1); `AgentLoop`, `ContextAssembler`, `ProviderRouter`, `ChatRepository`, tools.
- Produces:
  - `build_agent(*, user_id, channel, session_factory) -> _Adapter` where `_Adapter` has `async def handle(self, text: str) -> str`.
  - `AgentLoop.__init__` no longer accepts `chat_id`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_agent_builder.py`:

```python
import os
import pytest
from energybot.core.models import User, Profile

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


class _StubRouter:
    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        from energybot.providers.base import ChatResponse
        # tool_calls defaults to [] (falsy → loop exits after one turn); finish_reason is required.
        return ChatResponse(content="پاسخ آزمایشی", tokens_in=1, tokens_out=1, finish_reason="stop", model="stub")


@pytest.mark.asyncio
async def test_build_agent_handles_message_with_webchannel(monkeypatch, db_session):
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    monkeypatch.setenv("SESSION_SECRET", "z" * 32)
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "x")
    monkeypatch.setenv("BALE_BOT_TOKEN", "t")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    from energybot.settings import get_settings
    get_settings.cache_clear()

    u = User(bale_user_id=424242)
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()

    # Force the agent's provider router to our stub (no real LLM, no prompt rendering needed for content).
    import energybot.agent.builder as builder
    monkeypatch.setattr(builder, "ProviderRouter", lambda **kw: _StubRouter())

    from energybot.agent.channels import WebChannel
    def sf():
        return db_session
    agent = builder.build_agent(user_id=u.id, channel=WebChannel(), session_factory=sf)
    reply = await agent.handle("سلام")
    assert reply == "پاسخ آزمایشی"
```

> Note: `build_agent` imports `ProviderRouter` from `energybot.providers.router`; the test patches the name as referenced inside `builder`. If `build_agent` constructs the router differently, patch the actual symbol it uses. The stub returns a no-tool response so the loop exits after one turn. `ContextAssembler` will call `PromptLoader.render("system_prompt", …)`, which reads the DB — the `clean_router_tables` fixture leaves prompt tables empty, so seed is not required because the stub short-circuits the LLM; if `render` raises on a missing template, register a minimal `prompt_templates` row in the test or monkeypatch `PromptLoader.render` to return `("sys", "system_prompt", 1)`.

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_agent_builder.py -v`
Expected: FAIL (`ModuleNotFoundError: energybot.agent.builder`).

- [ ] **Step 3: Remove chat_id from AgentLoop**

In `src/energybot/agent/loop.py`, the `AgentLoop.__init__` signature currently ends with `user_id: UUID, chat_id: int`. Remove `chat_id`:

Change the constructor signature line from:
```python
                 user_id: UUID, chat_id: int):
```
to:
```python
                 user_id: UUID):
```
and delete the line `self._chat_id = chat_id`. (The field is never read elsewhere — confirm with `grep -n "_chat_id" src/energybot/agent/loop.py`, expect no remaining uses.)

- [ ] **Step 4: Create builder.py**

Create `src/energybot/agent/builder.py` (this is the body of the old `build_agent_for_user`, channel-agnostic, with `handle` taking just `text`):

```python
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
from energybot.billing.repository import BillingRepository
from energybot.chat.repository import ChatRepository
from energybot.profile.repository import ProfileRepository
from energybot.kb.retrieval import RetrievalService
from energybot.providers.factory import build_providers
from energybot.providers.router import ProviderRouter


def build_agent(*, user_id: UUID, channel, session_factory: Callable[[], AsyncSession]):
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
    registry.register(SendKBMediaTool(channel=channel, session_factory=session_factory))
    registry.register(ReadBillsTool(repo=BillingRepository(session_factory=session_factory), user_id=user_id))

    class _Adapter:
        async def handle(self_inner, text: str) -> str:
            summ = Summarizer(chat_repo=chat_repo, router=router, threshold=s.summary_message_threshold)
            loop = AgentLoop(
                router=router, context_assembler=asm, chat_repo=chat_repo,
                tool_registry=registry, summarizer=summ,
                tool_iteration_cap=s.tool_iteration_cap, user_id=user_id,
            )
            return await loop.handle_message(text)

    return _Adapter()
```

- [ ] **Step 5: Make build_agent_for_user a thin wrapper + update the call site**

In `src/energybot/bale_adapter/handler.py`:

(a) Replace the entire `build_agent_for_user` function body (everything from `def build_agent_for_user(...)` through `return _Adapter()`) with:

```python
def build_agent_for_user(user_id, chat_id, session_factory):
    from energybot.agent.builder import build_agent
    from energybot.agent.channels import BaleChannel
    return build_agent(user_id=user_id, channel=BaleChannel(get_bale_client(), chat_id), session_factory=session_factory)
```

(b) Update the agent call site. Find:
```python
            agent = build_agent_for_user(user.id, parsed.chat_id, session_factory)
            reply = await agent.handle(user.id, parsed.chat_id, text)
```
Replace with:
```python
            agent = build_agent_for_user(user.id, parsed.chat_id, session_factory)
            reply = await agent.handle(text)
```

(c) Remove now-unused imports at the top of `build_agent_for_user`'s old body that moved into `builder.py` — since the function body is replaced, ensure the file still imports what its remaining code needs (`get_bale_client`, `get_settings`, etc. used elsewhere in the file stay). Run `.venv/bin/python -c "import energybot.bale_adapter.handler"` to confirm no import errors.

- [ ] **Step 6: Run the builder test + full suite**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_agent_builder.py -v
.venv/bin/pytest -m "not llm" -q
```
Expected: builder test passes; full suite green (Bale handler tests unchanged). If a Bale handler test constructs `AgentLoop(...)` or calls `agent.handle(user_id, chat_id, text)` directly, update those call sites to the new signatures (`grep -rn "chat_id=" tests/ src/energybot/agent` and `grep -rn "\.handle(" tests/`).

- [ ] **Step 7: Commit**

```bash
git add src/energybot/agent/builder.py src/energybot/agent/loop.py src/energybot/bale_adapter/handler.py tests/integration/test_agent_builder.py
git commit -m "refactor(agent): extract channel-agnostic build_agent; drop unused chat_id"
```

---

### Task 3: ChatRepository — history_page + latest_assistant_message_id

**Files:**
- Modify: `src/energybot/chat/repository.py`
- Test: `tests/integration/test_chat_history.py`

**Interfaces:**
- Produces:
  - `async def history_page(self, user_id: UUID, *, before: int | None = None, limit: int = 30) -> list[Message]` — user+assistant, non-deleted, oldest-first within the page.
  - `async def latest_assistant_message_id(self, user_id: UUID) -> int | None`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/test_chat_history.py`:

```python
import os
import pytest
from energybot.core.models import User, ChatSession
from energybot.chat.repository import ChatRepository

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


async def _seed(db_session):
    u = User(bale_user_id=515151)
    db_session.add(u)
    await db_session.flush()
    sess = ChatSession(user_id=u.id)
    db_session.add(sess)
    await db_session.flush()
    repo = ChatRepository(session_factory=lambda: db_session)
    ids = []
    for i in range(5):
        ids.append(await repo.add_message(u.id, sess.id, role="user", content=f"u{i}"))
        ids.append(await repo.add_message(u.id, sess.id, role="assistant", content=f"a{i}"))
    # a stray tool row that must be excluded from history
    await repo.add_message(u.id, sess.id, role="tool", content="{}", tool_name="search_kb")
    return u, repo, ids


@pytest.mark.asyncio
async def test_history_page_returns_user_and_assistant_oldest_first(db_session):
    u, repo, ids = await _seed(db_session)
    page = await repo.history_page(u.id, limit=4)
    assert [m.content for m in page] == ["u3", "a3", "u4", "a4"]  # newest 4, oldest-first
    assert all(m.role in ("user", "assistant") for m in page)


@pytest.mark.asyncio
async def test_history_page_before_cursor_paginates(db_session):
    u, repo, ids = await _seed(db_session)
    first = await repo.history_page(u.id, limit=4)
    older = await repo.history_page(u.id, before=first[0].id, limit=4)
    assert [m.content for m in older] == ["u1", "a1", "u2", "a2"]


@pytest.mark.asyncio
async def test_latest_assistant_message_id(db_session):
    u, repo, ids = await _seed(db_session)
    last = await repo.latest_assistant_message_id(u.id)
    # last assistant content was "a4"; its id is the max assistant id
    assert last is not None
    page = await repo.history_page(u.id, limit=1)
    assert page[0].content == "a4" and page[0].id == last
```

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_chat_history.py -v`
Expected: FAIL (`AttributeError: 'ChatRepository' object has no attribute 'history_page'`).

- [ ] **Step 3: Add the repository methods**

In `src/energybot/chat/repository.py`, add these two methods to `ChatRepository` (the file already imports `select`, `desc`, `Message`, `UUID`):

```python
    async def history_page(self, user_id: UUID, *, before: int | None = None, limit: int = 30) -> list[Message]:
        s = self._session_factory()
        q = (
            select(Message)
            .where(Message.user_id == user_id, Message.role.in_(("user", "assistant")), Message.deleted_at.is_(None))
        )
        if before is not None:
            q = q.where(Message.id < before)
        q = q.order_by(desc(Message.id)).limit(limit)
        rows = (await s.execute(q)).scalars().all()
        return list(reversed(rows))

    async def latest_assistant_message_id(self, user_id: UUID) -> int | None:
        s = self._session_factory()
        return (await s.execute(
            select(Message.id)
            .where(Message.user_id == user_id, Message.role == "assistant", Message.deleted_at.is_(None))
            .order_by(desc(Message.id)).limit(1)
        )).scalar_one_or_none()
```

- [ ] **Step 4: Run to verify pass**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_chat_history.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/chat/repository.py tests/integration/test_chat_history.py
git commit -m "feat(chat): history_page + latest_assistant_message_id repo methods"
```

---

### Task 4: Media-serving endpoint + chat router scaffold

**Files:**
- Create: `src/energybot/user_api/chat.py`
- Modify: `src/energybot/main.py` (include the chat router)
- Test: `tests/integration/test_user_media.py`

**Interfaces:**
- Consumes: `current_user` (from `user_api/auth.py`), `core.db.get_session`, `core.models.KBAttachment`, `core.models.KBArticle`.
- Produces: `router` (APIRouter, prefix `/api/app`) with `GET /media/{attachment_id}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/test_user_media.py`:

```python
import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, KBArticle, KBAttachment
from energybot.user_api.tokens import mint_login_token

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in dict(DATABASE_URL=TEST_DB, SESSION_SECRET="z" * 32, BALE_WEBHOOK_SECRET="x",
                     BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m").items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    import energybot.user_api.auth as _uauth
    _uauth._REDEEM_HITS.clear()
    from energybot.main import create_app
    return create_app()


async def _login(client, db_session, bale_user_id):
    u = User(bale_user_id=bale_user_id)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    await client.post("/api/app/auth/redeem", json={"t": raw})
    return u


async def _attachment(db_session, tmp_path):
    art = KBArticle(title="t", category="electricity")
    db_session.add(art)
    await db_session.flush()
    f = tmp_path / "pic.png"
    f.write_bytes(b"\x89PNG\r\n\x1a\nDATA")
    att = KBAttachment(article_id=art.id, type="image", mime_type="image/png",
                       file_size_bytes=12, storage_path=str(f))
    db_session.add(att)
    await db_session.commit()
    return att


@pytest.mark.asyncio
async def test_media_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/media/00000000-0000-0000-0000-000000000000")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_media_serves_file(app, db_session, tmp_path):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 717171)
        att = await _attachment(db_session, tmp_path)
        r = await c.get(f"/api/app/media/{att.id}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("image/png")
    assert r.content == b"\x89PNG\r\n\x1a\nDATA"


@pytest.mark.asyncio
async def test_media_unknown_404(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 818181)
        r = await c.get("/api/app/media/11111111-1111-1111-1111-111111111111")
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_media.py -v`
Expected: FAIL (404→ but module/router missing → all 404 or ModuleNotFoundError on import).

- [ ] **Step 3: Create the chat router with the media endpoint**

Create `src/energybot/user_api/chat.py`:

```python
import os
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.db import get_session
from energybot.core.models import KBAttachment, User
from energybot.user_api.auth import current_user

router = APIRouter(prefix="/api/app", tags=["app"])


@router.get("/media/{attachment_id}")
async def media(attachment_id: str, user: User = Depends(current_user),
                session: AsyncSession = Depends(get_session)):
    try:
        aid = UUID(attachment_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    att = (await session.execute(
        select(KBAttachment).where(KBAttachment.id == aid, KBAttachment.deleted_at.is_(None))
    )).scalar_one_or_none()
    if att is None or not os.path.isfile(att.storage_path):
        raise HTTPException(status_code=404, detail="not found")
    return FileResponse(att.storage_path, media_type=att.mime_type)
```

- [ ] **Step 4: Wire the router into the app**

In `src/energybot/main.py`, add near the other user-api import:
```python
from energybot.user_api.chat import router as user_chat_router
```
and inside `create_app()` after `app.include_router(user_auth_router)`:
```python
    app.include_router(user_chat_router)
```

- [ ] **Step 5: Run to verify pass**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_media.py -v`
Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/user_api/chat.py src/energybot/main.py tests/integration/test_user_media.py
git commit -m "feat(user-web): GET /api/app/media/{id} serves KB attachments"
```

---

### Task 5: Chat SSE endpoint + history endpoint + settings

**Files:**
- Modify: `src/energybot/settings.py` (chunk settings)
- Modify: `src/energybot/user_api/chat.py` (add `POST /chat` SSE + `GET /chat/history`)
- Test: `tests/integration/test_user_chat_sse.py`

**Interfaces:**
- Consumes: `build_agent` (Task 2), `WebChannel` (Task 1), `ChatRepository.history_page` + `latest_assistant_message_id` (Task 3), `current_user`, `get_sessionmaker`.
- Produces: `POST /api/app/chat` (SSE), `GET /api/app/chat/history`.

- [ ] **Step 1: Add settings**

In `src/energybot/settings.py`, in `Settings` (near `web_login_token_ttl_minutes`):
```python
    web_chat_chunk_chars: int = 3
    web_chat_chunk_delay_ms: int = 12
```

- [ ] **Step 2: Write the failing tests**

Create `tests/integration/test_user_chat_sse.py`:

```python
import os
import json
from uuid import uuid4
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User
from energybot.user_api.tokens import mint_login_token

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in dict(DATABASE_URL=TEST_DB, SESSION_SECRET="z" * 32, BALE_WEBHOOK_SECRET="x",
                     BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m",
                     WEB_CHAT_CHUNK_DELAY_MS="0", WEB_CHAT_CHUNK_CHARS="3").items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    import energybot.user_api.auth as _uauth
    _uauth._REDEEM_HITS.clear()
    from energybot.main import create_app
    return create_app()


async def _login(client, db_session, bale_user_id):
    u = User(bale_user_id=bale_user_id)
    db_session.add(u)
    await db_session.flush()
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    r = await client.post("/api/app/auth/redeem", json={"t": raw})
    return u, r.headers["x-csrf"]


def _parse_sse(text):
    frames = []
    for block in text.strip().split("\n\n"):
        ev = data = None
        for line in block.splitlines():
            if line.startswith("event: "):
                ev = line[len("event: "):]
            elif line.startswith("data: "):
                data = json.loads(line[len("data: "):])
        if ev:
            frames.append((ev, data))
    return frames


@pytest.mark.asyncio
async def test_chat_streams_status_media_chunks_done(app, db_session, monkeypatch):
    # Replace build_agent inside the chat module with a fake that buffers a media event
    # and returns a fixed reply, so framing is deterministic without an LLM.
    import energybot.user_api.chat as chat_mod

    def fake_build_agent(*, user_id, channel, session_factory):
        class _A:
            async def handle(self, text):
                from types import SimpleNamespace
                await channel.send_media(SimpleNamespace(id=uuid4(), type="image"), "کپ")
                return "سلام"  # 4 chars → 2 chunks at chunk_chars=3
        return _A()

    monkeypatch.setattr(chat_mod, "build_agent", fake_build_agent)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 919191)
        r = await c.post("/api/app/chat", json={"text": "سلام"}, headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    frames = _parse_sse(r.text)
    kinds = [ev for ev, _ in frames]
    assert kinds[0] == "status"
    assert "media" in kinds
    assert kinds.count("chunk") == 2
    assert kinds[-1] == "done"
    # reassembled text equals the reply
    assert "".join(d["text"] for ev, d in frames if ev == "chunk") == "سلام"


@pytest.mark.asyncio
async def test_chat_emits_error_frame_on_agent_failure(app, db_session, monkeypatch):
    import energybot.user_api.chat as chat_mod

    def boom_build_agent(*, user_id, channel, session_factory):
        class _A:
            async def handle(self, text):
                raise RuntimeError("kaboom")
        return _A()

    monkeypatch.setattr(chat_mod, "build_agent", boom_build_agent)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 929292)
        r = await c.post("/api/app/chat", json={"text": "x"}, headers={"x-csrf": csrf})
    frames = _parse_sse(r.text)
    assert frames[0][0] == "status"
    assert frames[-1][0] == "error"
    assert "مشکل فنی" in frames[-1][1]["text"]


@pytest.mark.asyncio
async def test_chat_requires_csrf(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 939393)
        r = await c.post("/api/app/chat", json={"text": "x"})  # no x-csrf header
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_history_endpoint_returns_messages(app, db_session, monkeypatch):
    import energybot.user_api.chat as chat_mod

    def fake_build_agent(*, user_id, channel, session_factory):
        class _A:
            async def handle(self, text):
                return "پاسخ"
        return _A()
    monkeypatch.setattr(chat_mod, "build_agent", fake_build_agent)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 949494)
        await c.post("/api/app/chat", json={"text": "سوال"}, headers={"x-csrf": csrf})
        r = await c.get("/api/app/chat/history")
    assert r.status_code == 200
    items = r.json()["messages"]
    assert [m["role"] for m in items] == ["user", "assistant"]
    assert items[0]["content"] == "سوال" and items[1]["content"] == "پاسخ"
```

- [ ] **Step 3: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_chat_sse.py -v`
Expected: FAIL (no `/chat` route → 405/404; no `build_agent` symbol in chat module to patch → AttributeError).

- [ ] **Step 4: Implement the SSE + history endpoints**

Edit `src/energybot/user_api/chat.py`. Add imports at the top (keep the existing ones):

```python
import asyncio
import json
from typing import Annotated
from fastapi import Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from energybot.core.db import get_sessionmaker
from energybot.settings import get_settings
from energybot.agent.builder import build_agent
from energybot.agent.channels import WebChannel
from energybot.chat.repository import ChatRepository
from energybot.logging import get_logger
```

Then append to the file:

```python
class ChatIn(BaseModel):
    text: str


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


_FALLBACK = "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"


@router.post("/chat")
async def chat(payload: ChatIn, user: User = Depends(current_user)):
    s = get_settings()
    sf = get_sessionmaker()
    text = payload.text

    async def gen():
        yield _sse("status", {"text": "در حال فکر کردن…"})
        web = WebChannel()
        try:
            agent = build_agent(user_id=user.id, channel=web, session_factory=sf)
            final = await agent.handle(text)
        except Exception:
            get_logger(__name__).exception("web_chat_failed", user_id=str(user.id))
            yield _sse("error", {"text": _FALLBACK})
            return
        for ev in web.events:
            yield _sse("media", ev)
        n = max(1, s.web_chat_chunk_chars)
        for i in range(0, len(final), n):
            yield _sse("chunk", {"text": final[i:i + n]})
            if s.web_chat_chunk_delay_ms:
                await asyncio.sleep(s.web_chat_chunk_delay_ms / 1000)
        chat_repo = ChatRepository(session_factory=sf, idle_minutes=s.session_idle_minutes)
        msg_id = await chat_repo.latest_assistant_message_id(user.id)
        yield _sse("done", {"message_id": msg_id})

    return StreamingResponse(gen(), media_type="text/event-stream")


@router.get("/chat/history")
async def chat_history(
    user: User = Depends(current_user),
    before: Annotated[int | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 30,
):
    s = get_settings()
    repo = ChatRepository(session_factory=get_sessionmaker(), idle_minutes=s.session_idle_minutes)
    rows = await repo.history_page(user.id, before=before, limit=limit)
    return {"messages": [
        {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
        for m in rows
    ]}
```

> CSRF note: `current_user` enforces the `x-csrf` header on `POST` (the `test_chat_requires_csrf` case). The CSRF token does not rotate (it is `sign_csrf(secret, sid)`), so the client keeps using the token it captured at login — the streaming response need not echo a fresh one.

- [ ] **Step 5: Run the tests**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_chat_sse.py -v`
Expected: 4 passed.

- [ ] **Step 6: Run the full backend suite**

Run: `.venv/bin/pytest -m "not llm" -q` and (with `TEST_DATABASE_URL`) the integration suite for the user_api + chat tests. Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/energybot/settings.py src/energybot/user_api/chat.py tests/integration/test_user_chat_sse.py
git commit -m "feat(user-web): POST /api/app/chat SSE + GET /chat/history"
```

---

### Task 6: Frontend `/app/chat` screen + streamChat client

**Files:**
- Modify: `app_ui/src/lib/api.ts` (add `streamChat`, `getHistory`)
- Create: `app_ui/src/app/chat/page.tsx`
- Test: build + in-process serve smoke (no FE unit tests in this repo)

**Interfaces:**
- Consumes: `POST /api/app/chat` (SSE), `GET /api/app/chat/history`.

> No FE unit-test framework exists in this repo. Verification = `npm run build` succeeds, `app_ui/out/chat/index.html` exists, and the existing in-process serve smoke still passes.

- [ ] **Step 1: Add the API client functions**

Append to `app_ui/src/lib/api.ts` (the file already has the module-level `csrf` variable and `req` helper from Stage 1):

```ts
export type ChatMsg = { id: number; role: "user" | "assistant"; content: string; created_at: string };

export async function getHistory(before?: number): Promise<ChatMsg[]> {
  const qs = before ? `?before=${before}` : "";
  const r = await req(`/chat/history${qs}`);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).messages;
}

export type StreamHandlers = {
  onStatus?: (t: string) => void;
  onMedia?: (m: { attachment_id: string; media_type: string; url: string; caption: string | null }) => void;
  onChunk?: (t: string) => void;
  onDone?: (messageId: number | null) => void;
  onError?: (t: string) => void;
};

export async function streamChat(text: string, h: StreamHandlers): Promise<void> {
  const headers = new Headers({ "content-type": "application/json" });
  if (csrf) headers.set("x-csrf", csrf);
  const res = await fetch("/api/app/chat", {
    method: "POST", headers, credentials: "same-origin", body: JSON.stringify({ text }),
  });
  if (!res.ok || !res.body) { h.onError?.("خطا در ارتباط با سرور"); return; }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const frame = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const ev = /^event: (.*)$/m.exec(frame)?.[1];
        const dataLine = /^data: (.*)$/m.exec(frame)?.[1];
        if (!ev || dataLine === undefined) continue;
        const data = JSON.parse(dataLine);
        if (ev === "status") h.onStatus?.(data.text);
        else if (ev === "media") h.onMedia?.(data);
        else if (ev === "chunk") h.onChunk?.(data.text);
        else if (ev === "done") h.onDone?.(data.message_id ?? null);
        else if (ev === "error") h.onError?.(data.text);
      }
    }
  } catch {
    h.onError?.("ارتباط قطع شد");
  }
}
```

- [ ] **Step 2: Build the chat page**

Create `app_ui/src/app/chat/page.tsx`:

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getHistory, streamChat, type ChatMsg } from "@/lib/api";

type Bubble =
  | { kind: "text"; role: "user" | "assistant"; content: string }
  | { kind: "media"; url: string; mediaType: string; caption: string | null }
  | { kind: "error"; content: string };

export default function ChatPage() {
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [oldestId, setOldestId] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getHistory().then((msgs: ChatMsg[]) => {
      setBubbles(msgs.map((m) => ({ kind: "text", role: m.role, content: m.content })));
      if (msgs.length) setOldestId(msgs[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [bubbles, status]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setBubbles((b) => [...b, { kind: "text", role: "user", content: text }]);
    let assistantIndex = -1;
    await streamChat(text, {
      onStatus: (t) => setStatus(t),
      onMedia: (m) => setBubbles((b) => [...b, { kind: "media", url: m.url, mediaType: m.media_type, caption: m.caption }]),
      onChunk: (t) => setBubbles((b) => {
        setStatus(null);
        const copy = [...b];
        if (assistantIndex === -1) { assistantIndex = copy.length; copy.push({ kind: "text", role: "assistant", content: t }); }
        else { const cur = copy[assistantIndex] as Extract<Bubble, { kind: "text" }>; copy[assistantIndex] = { ...cur, content: cur.content + t }; }
        return copy;
      }),
      onDone: () => { setStatus(null); setBusy(false); },
      onError: (t) => { setStatus(null); setBusy(false); setBubbles((b) => [...b, { kind: "error", content: t }]); },
    });
  }

  async function loadOlder() {
    if (oldestId == null) return;
    const older = await getHistory(oldestId);
    if (older.length) {
      setBubbles((b) => [...older.map((m) => ({ kind: "text", role: m.role, content: m.content } as Bubble)), ...b]);
      setOldestId(older[0].id);
    }
  }

  return (
    <AppShell>
      <div className="flex flex-col h-[calc(100vh-8rem)]" dir="rtl">
        {oldestId != null && (
          <button onClick={loadOlder} className="mx-auto mb-2 text-xs text-muted-foreground hover:text-foreground">
            نمایش پیام‌های قبلی
          </button>
        )}
        <div className="flex-1 overflow-y-auto space-y-3 px-1">
          {bubbles.map((b, i) => {
            if (b.kind === "media") {
              return (
                <div key={i} className="flex justify-start">
                  <div className="max-w-[80%] rounded-lg overflow-hidden border">
                    {b.mediaType === "video"
                      ? <video src={b.url} controls className="max-w-full" />
                      : <img src={b.url} alt={b.caption ?? ""} className="max-w-full" />}
                    {b.caption && <div className="p-2 text-sm">{b.caption}</div>}
                  </div>
                </div>
              );
            }
            if (b.kind === "error") {
              return <div key={i} className="text-center text-sm text-red-500">{b.content}</div>;
            }
            const mine = b.role === "user";
            return (
              <div key={i} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                  {b.content}
                </div>
              </div>
            );
          })}
          {status && <div className="text-center text-xs text-muted-foreground">{status}</div>}
          <div ref={endRef} />
        </div>
        <div className="mt-3 flex gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
            rows={1}
            placeholder="پیامت را بنویس…"
            className="flex-1 resize-none rounded-md border px-3 py-2 text-sm"
          />
          <button onClick={send} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">
            ارسال
          </button>
        </div>
      </div>
    </AppShell>
  );
}
```

> If `bg-primary`/`text-primary-foreground` are not defined in `app_ui`'s theme, use the same token the Stage 1 components used for accent (check `globals.css`); fall back to `bg-muted` for assistant and a neutral accent for user. The build must not fail on an undefined utility.

- [ ] **Step 3: Build the frontend**

Run: `cd app_ui && npm run build && cd ..`
Expected: build succeeds; `ls app_ui/out/chat/index.html` exists.

- [ ] **Step 4: In-process serve smoke**

Run (mirrors the Stage 1 smoke; confirms the route is served):
```bash
ENERGYBOT_APP_STATIC_DIR=app_ui/out .venv/bin/python - <<'PY'
import os
os.environ.update(DATABASE_URL="postgresql+asyncpg://x:x@localhost:5433/x", SESSION_SECRET="z"*32,
    BALE_WEBHOOK_SECRET="x", BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m")
import asyncio
from httpx import ASGITransport, AsyncClient
from energybot.main import create_app
app = create_app()
async def main():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", follow_redirects=True) as c:
        r = await c.get("/app/chat/")
        assert r.status_code == 200 and "html" in r.headers.get("content-type",""), r.status_code
    print("SMOKE OK")
asyncio.run(main())
PY
```
Expected: `SMOKE OK`.

- [ ] **Step 5: Commit**

```bash
git add app_ui/src/lib/api.ts app_ui/src/app/chat/page.tsx
git commit -m "feat(app_ui): /app/chat streaming chat screen"
```

---

## Self-Review

**Spec coverage:**
- §4.1 `ResponseChannel`/`BaleChannel`/`WebChannel` → Task 1. ✓
- §4.2 `SendKBMediaTool` refactor → Task 1. ✓
- §4.3 `build_agent` extraction → Task 2. ✓
- §4.4 drop `chat_id` from `AgentLoop` → Task 2. ✓
- §4.5 Bale regression guard → Task 1 (channel test) + Task 2 (full-suite gate). ✓
- §5.1 `POST /chat` SSE order `status→media*→chunk*→done`, error frame → Task 5. ✓
- §5.2 `latest_assistant_message_id` → Task 3 (method) + Task 5 (use). ✓
- §5.3 chunk settings → Task 5. ✓
- §6 media endpoint → Task 4. ✓
- §7 history endpoint + `history_page` → Task 3 (method) + Task 5 (endpoint). ✓
- §8 `/app/chat` + `streamChat` → Task 6. ✓
- §9 error handling (SSE error frame, media 404, client mid-stream failure) → Tasks 5, 4, 6. ✓
- §10 testing → each task's tests. ✓
- §11 build order → Tasks map 1+2 / 4 / 3+5 / 6. ✓

**Placeholder scan:** No "TBD"/"similar to"/"add error handling". The two `>` notes (builder test prompt-render fallback; frontend theme-token fallback) are concrete contingencies with exact instructions, not deferrals.

**Type consistency:** `build_agent(*, user_id, channel, session_factory)` and adapter `handle(text)` are consistent across Tasks 2, 5, and the test fakes. `WebChannel.events` event shape (`type/attachment_id/media_type/url/caption`) matches between Task 1, the SSE `media` frame (Task 5), and `StreamHandlers.onMedia` (Task 6). `history_page(user_id, *, before, limit)` and `latest_assistant_message_id(user_id)` match between Task 3 and Task 5. SSE frame names (`status/media/chunk/done/error`) match across Tasks 5 and 6.

## Notes for later stages (not part of this plan)
- Stage 3: bills/profile/history screens; the `/app/history` session browser; profile/bills `/api/app` endpoints.
- Deferred: true token streaming; live per-tool status; historical media reconstruction.
