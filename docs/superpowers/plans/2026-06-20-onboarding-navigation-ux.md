# Onboarding & Navigation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Bale bot a smooth onboarding (intro + profile wizard on first contact), a persistent home/navigation surface with a reply-keyboard menu and native command list, and LLM-chosen contextual action buttons at the end of chat replies.

**Architecture:** A bounded **quick-action catalog** (`bale_adapter/actions.py`) is the single source of truth for every button label and its routing. A new **home** module renders the intro/home message and installs the persistent reply keyboard. The handler gains a first-contact interceptor, a reply-keyboard label router, and an `act:`-prefixed callback branch — all routing through shared helper coroutines. The agent gains a `suggest_actions` tool whose chosen keys are returned from `agent.handle()` and rendered as inline buttons.

**Tech Stack:** Python 3.10, FastAPI, SQLAlchemy async, httpx, pytest/pytest-asyncio. Bale Bot API (`tapi.bale.ai`).

## Global Constraints

- Persian-only user-facing copy. All button labels and messages in Farsi.
- Bale, like Telegram, allows exactly **one** `reply_markup` per message. The home message carries the persistent **reply keyboard**; end-of-chat suggestions are **inline** buttons on a separate message.
- The quick-action catalog is the ONLY place button keys/labels/routing are defined. No button may be rendered whose key is absent from the catalog.
- A user is **new** iff they have no `OnboardingState` row. First-contact onboarding applies to inbound **text** updates only (not callbacks/photos).
- Follow existing patterns: lazy imports inside `handle_bale_update` for heavy deps, `FakeBale`/`FakeAgent` test doubles, `get_logger(__name__)` for logging.
- Reply-keyboard buttons send their label text back as a normal message; the label router must use **exact** string match (not substring) so ordinary chat text is never intercepted.

---

### Task 1: `BaleClient.set_my_commands` + register native command menu at startup

**Files:**
- Modify: `src/energybot/bale_adapter/client.py` (add method after `answer_callback_query`, ~line 39)
- Modify: `src/energybot/bale_adapter/commands.py` (add `BOT_COMMAND_MENU`)
- Modify: `src/energybot/main.py` (call inside `lifespan`, after `s = get_settings()` ~line 64)
- Test: `tests/integration/test_bale_client_commands.py`

**Interfaces:**
- Produces: `BaleClient.set_my_commands(commands: list[dict]) -> None` — POSTs `setMyCommands` with `{"commands": commands}`; logs and swallows errors (non-fatal).
- Produces: `BOT_COMMAND_MENU: list[dict]` in `commands.py` — each `{"command": "<no-slash>", "description": "<persian>"}`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_bale_client_commands.py`:

```python
import pytest
from energybot.bale_adapter.client import BaleClient
from energybot.bale_adapter.commands import BOT_COMMAND_MENU


@pytest.mark.asyncio
async def test_set_my_commands_posts_payload():
    client = BaleClient(token="x")
    captured = {}

    async def fake_post(method, payload):
        captured["method"] = method
        captured["payload"] = payload
        return {"ok": True, "result": True}

    client._post_json = fake_post  # type: ignore[assignment]
    await client.set_my_commands(BOT_COMMAND_MENU)
    assert captured["method"] == "setMyCommands"
    assert captured["payload"]["commands"][0]["command"] == "start"
    # commands registered without a leading slash
    assert all(not c["command"].startswith("/") for c in captured["payload"]["commands"])
    assert any(c["command"] == "bill" for c in captured["payload"]["commands"])


@pytest.mark.asyncio
async def test_set_my_commands_swallows_errors():
    client = BaleClient(token="x")

    async def boom(method, payload):
        raise RuntimeError("network down")

    client._post_json = boom  # type: ignore[assignment]
    # Must not raise — registration is best-effort at startup.
    await client.set_my_commands(BOT_COMMAND_MENU)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_bale_client_commands.py -v`
Expected: FAIL — `ImportError: cannot import name 'BOT_COMMAND_MENU'` / `AttributeError: 'BaleClient' object has no attribute 'set_my_commands'`.

- [ ] **Step 3: Add `BOT_COMMAND_MENU` to `commands.py`**

Append to `src/energybot/bale_adapter/commands.py`:

```python
BOT_COMMAND_MENU = [
    {"command": "start", "description": "شروع و معرفی"},
    {"command": "help", "description": "راهنما"},
    {"command": "profile", "description": "مشاهده پروفایل"},
    {"command": "bill", "description": "استعلام و پرداخت قبض"},
    {"command": "web", "description": "ورود به نسخهٔ وب"},
    {"command": "restart", "description": "شروع گفتگوی تازه"},
]
```

- [ ] **Step 4: Add `set_my_commands` to `BaleClient`**

In `src/energybot/bale_adapter/client.py`, after the `answer_callback_query` method (~line 39):

```python
    async def set_my_commands(self, commands: list[dict]) -> None:
        # Registers Bale's native "/" command menu. Best-effort: a transient
        # failure at startup must not crash the app.
        from energybot.logging import get_logger
        try:
            await self._post_json("setMyCommands", {"commands": commands})
        except Exception as e:  # noqa: BLE001
            get_logger(__name__).warning("set_my_commands_failed", error=str(e))
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/integration/test_bale_client_commands.py -v`
Expected: PASS (both tests).

- [ ] **Step 6: Register at startup in `main.py`**

In `src/energybot/main.py`, inside `lifespan`, after `s = get_settings()` and before `sched = make_scheduler()`:

```python
    if s.bale_bot_token:
        from energybot.bale_adapter.handler import get_bale_client
        from energybot.bale_adapter.commands import BOT_COMMAND_MENU
        await get_bale_client().set_my_commands(BOT_COMMAND_MENU)
```

- [ ] **Step 7: Verify app imports cleanly**

Run: `python -c "import energybot.main"`
Expected: no error.

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/client.py src/energybot/bale_adapter/commands.py src/energybot/main.py tests/integration/test_bale_client_commands.py
git commit -m "feat(bale): register native command menu via setMyCommands"
```

---

### Task 2: Quick-action catalog (`bale_adapter/actions.py`)

**Files:**
- Create: `src/energybot/bale_adapter/actions.py`
- Test: `tests/unit/test_actions_catalog.py`

**Interfaces:**
- Produces: `@dataclass QuickAction(key: str, label: str, kind: str, prompt: str | None = None)` — `kind ∈ {"profile","bill","web","home","prompt"}`.
- Produces: `CATALOG: dict[str, QuickAction]` keyed by action key.
- Produces: `CATALOG_KEYS: list[str]` — `list(CATALOG.keys())`, used as the `suggest_actions` tool enum.
- Produces: `build_suggestions_markup(keys: list[str]) -> dict | None` — inline keyboard with `callback_data="act:<key>"`; drops unknown keys; returns `None` if nothing valid.
- Produces: `REPLY_KB_ROUTES: dict[str, str]` — persistent reply-keyboard label → kind (`{"قبض من":"bill","پروفایل":"profile","نسخه وب":"web","راهنما":"home"}`).

This module imports nothing from `handler`/`home` (keep it dependency-free to avoid cycles).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/test_actions_catalog.py`:

```python
from energybot.bale_adapter.actions import (
    CATALOG, CATALOG_KEYS, build_suggestions_markup, REPLY_KB_ROUTES, QuickAction,
)


def test_catalog_has_expected_keys():
    assert set(CATALOG_KEYS) == {
        "view_profile", "query_bill", "web_login", "saving_tips", "set_goal", "more_help",
    }
    for key, action in CATALOG.items():
        assert isinstance(action, QuickAction)
        assert action.key == key
        assert action.label  # non-empty Persian label
        assert action.kind in {"profile", "bill", "web", "home", "prompt"}
        if action.kind == "prompt":
            assert action.prompt


def test_build_suggestions_markup_renders_inline_buttons():
    markup = build_suggestions_markup(["query_bill", "view_profile"])
    rows = markup["inline_keyboard"]
    assert rows[0][0]["callback_data"] == "act:query_bill"
    assert rows[0][0]["text"] == CATALOG["query_bill"].label
    assert rows[1][0]["callback_data"] == "act:view_profile"


def test_build_suggestions_markup_drops_unknown_and_empty():
    assert build_suggestions_markup([]) is None
    assert build_suggestions_markup(["bogus"]) is None
    markup = build_suggestions_markup(["bogus", "web_login"])
    assert len(markup["inline_keyboard"]) == 1
    assert markup["inline_keyboard"][0][0]["callback_data"] == "act:web_login"


def test_reply_kb_routes_cover_core_four():
    assert REPLY_KB_ROUTES == {
        "قبض من": "bill", "پروفایل": "profile", "نسخه وب": "web", "راهنما": "home",
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_actions_catalog.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.bale_adapter.actions'`.

- [ ] **Step 3: Create `actions.py`**

Create `src/energybot/bale_adapter/actions.py`:

```python
from dataclasses import dataclass


@dataclass(slots=True)
class QuickAction:
    key: str
    label: str           # Persian button label
    kind: str            # "profile" | "bill" | "web" | "home" | "prompt"
    prompt: str | None = None  # required when kind == "prompt"


CATALOG: dict[str, QuickAction] = {
    "view_profile": QuickAction("view_profile", "پروفایل من", "profile"),
    "query_bill": QuickAction("query_bill", "استعلام قبض", "bill"),
    "web_login": QuickAction("web_login", "نسخهٔ وب", "web"),
    "saving_tips": QuickAction(
        "saving_tips", "راه‌های صرفه‌جویی", "prompt",
        "چند راه ساده و کاربردی برای کاهش مصرف انرژی در خانه بهم بگو.",
    ),
    "set_goal": QuickAction(
        "set_goal", "تعیین هدف", "prompt",
        "می‌خوام یک هدف صرفه‌جویی انرژی تعیین کنم. کمکم کن یک هدف مشخص و قابل‌اندازه‌گیری بذارم.",
    ),
    "more_help": QuickAction("more_help", "راهنما", "home"),
}

CATALOG_KEYS: list[str] = list(CATALOG.keys())

# Persistent reply-keyboard labels -> action kind. Labels are matched exactly.
REPLY_KB_ROUTES: dict[str, str] = {
    "قبض من": "bill",
    "پروفایل": "profile",
    "نسخه وب": "web",
    "راهنما": "home",
}


def build_suggestions_markup(keys: list[str]) -> dict | None:
    rows = [
        [{"text": CATALOG[k].label, "callback_data": f"act:{k}"}]
        for k in keys
        if k in CATALOG
    ]
    if not rows:
        return None
    return {"inline_keyboard": rows}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/unit/test_actions_catalog.py -v`
Expected: PASS (all four tests).

- [ ] **Step 5: Commit**

```bash
git add src/energybot/bale_adapter/actions.py tests/unit/test_actions_catalog.py
git commit -m "feat(bale): add quick-action catalog and suggestion markup builder"
```

---

### Task 3: Home module (`bale_adapter/home.py`)

**Files:**
- Create: `src/energybot/bale_adapter/home.py`
- Test: `tests/unit/test_home.py`

**Interfaces:**
- Produces: `INTRO_TEXT: str` — first-contact self-introduction (shown before the wizard).
- Produces: `HOME_TEXT: str` — returning/home message; MUST contain an explicit "you can chat directly" line.
- Produces: `REPLY_KEYBOARD: dict` — Bale reply-keyboard markup with the core-4 buttons (objects, not bare strings), `resize_keyboard: True`.
- Produces: `build_home_message() -> tuple[str, dict]` — returns `(HOME_TEXT, REPLY_KEYBOARD)`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/test_home.py`:

```python
from energybot.bale_adapter.home import INTRO_TEXT, HOME_TEXT, REPLY_KEYBOARD, build_home_message
from energybot.bale_adapter.actions import REPLY_KB_ROUTES


def test_intro_and_home_text_present():
    assert INTRO_TEXT.strip()
    assert HOME_TEXT.strip()
    # Home must explicitly tell the user they can chat directly.
    assert "بنویس" in HOME_TEXT or "بپرس" in HOME_TEXT


def test_reply_keyboard_labels_match_router():
    labels = {btn["text"] for row in REPLY_KEYBOARD["keyboard"] for btn in row}
    assert labels == set(REPLY_KB_ROUTES.keys())
    assert REPLY_KEYBOARD["resize_keyboard"] is True


def test_build_home_message_returns_text_and_keyboard():
    text, markup = build_home_message()
    assert text == HOME_TEXT
    assert markup is REPLY_KEYBOARD
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_home.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.bale_adapter.home'`.

- [ ] **Step 3: Create `home.py`**

Create `src/energybot/bale_adapter/home.py`:

```python
INTRO_TEXT = (
    "سلام! 👋 من دستیار صرفه‌جویی انرژی هستم. "
    "کمکت می‌کنم مصرف برق و گاز خونه‌ات رو کم کنی، قبض‌هات رو بررسی و پرداخت کنی "
    "و راهکارهای عملی برای صرفه‌جویی یاد بگیری.\n"
    "برای شروع، چند سؤال کوتاه می‌پرسم تا خونه‌ات رو بهتر بشناسم. 🙂"
)

HOME_TEXT = (
    "چطور می‌تونم کمکت کنم؟ 🙂\n"
    "از دکمه‌های پایین استفاده کن: «قبض من» برای استعلام و پرداخت قبض، "
    "«پروفایل» برای دیدن اطلاعاتت، «نسخه وب» برای ورود به پنل وب.\n"
    "همینطور هر سؤالی دربارهٔ صرفه‌جویی انرژی داری، مستقیم همینجا برام بنویس."
)

REPLY_KEYBOARD = {
    "keyboard": [
        [{"text": "قبض من"}, {"text": "پروفایل"}],
        [{"text": "نسخه وب"}, {"text": "راهنما"}],
    ],
    "resize_keyboard": True,
}


def build_home_message() -> tuple[str, dict]:
    return HOME_TEXT, REPLY_KEYBOARD
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/unit/test_home.py -v`
Expected: PASS (all three tests).

- [ ] **Step 5: Commit**

```bash
git add src/energybot/bale_adapter/home.py tests/unit/test_home.py
git commit -m "feat(bale): add home/intro module with persistent reply keyboard"
```

---

### Task 4: `suggest_actions` tool + `AgentResult` (agent.handle returns text + suggestions)

**Files:**
- Create: `src/energybot/agent/tools/suggest_actions.py`
- Create: `src/energybot/agent/result.py`
- Modify: `src/energybot/agent/builder.py` (register tool; return `AgentResult`)
- Modify: `tests/integration/test_bot_handler.py` (`FakeAgent` now returns `AgentResult`)
- Test: `tests/unit/test_suggest_actions_tool.py`

**Interfaces:**
- Produces: `@dataclass AgentResult(text: str, suggestions: list[str])` in `agent/result.py`.
- Produces: `SuggestActionsTool` — `name="suggest_actions"`, attribute `selected: list[str]`, `reset()`, `invoke()` filters args against `CATALOG_KEYS` and keeps ≤3.
- Changes: `build_agent(...).handle(text) -> AgentResult` (was `-> str`). The loop still returns the text; the adapter wraps it with `suggest_tool.selected`.
- Consumes: `CATALOG_KEYS` from Task 2.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/test_suggest_actions_tool.py`:

```python
import pytest
from energybot.agent.tools.suggest_actions import SuggestActionsTool
from energybot.bale_adapter.actions import CATALOG_KEYS


@pytest.mark.asyncio
async def test_suggest_actions_records_valid_keys():
    tool = SuggestActionsTool()
    assert tool.name == "suggest_actions"
    # enum constrains the model to catalog keys
    assert set(tool.parameters["properties"]["actions"]["items"]["enum"]) == set(CATALOG_KEYS)
    await tool.invoke({"actions": ["query_bill", "view_profile"]})
    assert tool.selected == ["query_bill", "view_profile"]


@pytest.mark.asyncio
async def test_suggest_actions_filters_unknown_and_caps_three():
    tool = SuggestActionsTool()
    await tool.invoke({"actions": ["bogus", "query_bill", "web_login", "set_goal", "more_help"]})
    assert tool.selected == ["query_bill", "web_login", "set_goal"]
    assert "bogus" not in tool.selected


@pytest.mark.asyncio
async def test_reset_clears_selection():
    tool = SuggestActionsTool()
    await tool.invoke({"actions": ["more_help"]})
    tool.reset()
    assert tool.selected == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_suggest_actions_tool.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.agent.tools.suggest_actions'`.

- [ ] **Step 3: Create the tool**

Create `src/energybot/agent/tools/suggest_actions.py`:

```python
from typing import Any
from energybot.bale_adapter.actions import CATALOG_KEYS


class SuggestActionsTool:
    name = "suggest_actions"
    description = (
        "در پایان پاسخ، ۰ تا ۳ دکمهٔ اقدام مرتبط به کاربر پیشنهاد بده. "
        "فقط وقتی استفاده کن که اقدام بعدی مشخصی برای کاربر وجود دارد."
    )
    parameters = {
        "type": "object",
        "properties": {
            "actions": {
                "type": "array",
                "items": {"type": "string", "enum": CATALOG_KEYS},
                "maxItems": 3,
            }
        },
        "required": ["actions"],
    }

    def __init__(self) -> None:
        self.selected: list[str] = []

    def reset(self) -> None:
        self.selected = []

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        keys = [k for k in (args.get("actions") or []) if k in CATALOG_KEYS][:3]
        self.selected = keys
        return {"accepted": keys}
```

- [ ] **Step 4: Run tool test to verify it passes**

Run: `pytest tests/unit/test_suggest_actions_tool.py -v`
Expected: PASS.

- [ ] **Step 5: Create `AgentResult`**

Create `src/energybot/agent/result.py`:

```python
from dataclasses import dataclass, field


@dataclass(slots=True)
class AgentResult:
    text: str
    suggestions: list[str] = field(default_factory=list)
```

- [ ] **Step 6: Wire the tool + result into `builder.py`**

In `src/energybot/agent/builder.py`, add imports near the other tool imports:

```python
from energybot.agent.tools.suggest_actions import SuggestActionsTool
from energybot.agent.result import AgentResult
```

Register the tool after the `ReadBillsTool` registration (~line 38):

```python
    suggest_tool = SuggestActionsTool()
    registry.register(suggest_tool)
```

Replace the `_Adapter` class (lines 40-50) with:

```python
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
```

- [ ] **Step 7: Update the handler's chat call site to use `.text`**

In `src/energybot/bale_adapter/handler.py`, replace the chat block (lines 140-147) with:

```python
        try:
            agent = build_agent_for_user(user.id, parsed.chat_id, session_factory)
            result = await agent.handle(text)
            reply_text = result.text
        except Exception:
            from energybot.logging import get_logger
            get_logger(__name__).exception("agent_call_failed", user_id=str(user.id), chat_id=parsed.chat_id)
            reply_text = "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"
        await bale.send_message(chat_id=parsed.chat_id, text=reply_text)
```

(Suggestion rendering is added in Task 7; this step only keeps the suite green with the new return type.)

- [ ] **Step 8: Update `FakeAgent` in the handler test**

In `tests/integration/test_bot_handler.py`, replace the `FakeAgent` class (lines 19-20) with:

```python
from energybot.agent.result import AgentResult


class FakeAgent:
    async def handle(self, text):
        return AgentResult(text="پاسخ دستیار: " + text, suggestions=[])
```

- [ ] **Step 9: Run the affected suites**

Run: `pytest tests/unit/test_suggest_actions_tool.py tests/integration/test_bot_handler.py tests/integration/test_agent_loop.py -v`
Expected: PASS. (`test_agent_loop` exercises `loop.handle_message`, which still returns `str` — unaffected.)

- [ ] **Step 10: Commit**

```bash
git add src/energybot/agent/tools/suggest_actions.py src/energybot/agent/result.py src/energybot/agent/builder.py src/energybot/bale_adapter/handler.py tests/unit/test_suggest_actions_tool.py tests/integration/test_bot_handler.py
git commit -m "feat(agent): suggest_actions tool; handle() returns AgentResult"
```

---

### Task 5: First-contact onboarding + `/start` home/resume + `/help` → home

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py` (imports; first-contact interceptor; `/start` and `/help` branches; new `_send_home` helper)
- Test: `tests/integration/test_onboarding_flow.py`

**Interfaces:**
- Consumes: `INTRO_TEXT`, `build_home_message` (Task 3); `OnboardingState` (`energybot.core.models`).
- Produces: `_send_home(bale, chat_id) -> None` — sends `build_home_message()`.
- Produces: `_has_onboarding_state(session, user_id) -> bool` — true iff an `OnboardingState` row exists.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_onboarding_flow.py`:

```python
import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, OnboardingState
from energybot.agent.result import AgentResult


class FakeBale:
    def __init__(self):
        self.sent = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1

    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass


class FakeAgent:
    async def handle(self, text):
        return AgentResult(text="پاسخ: " + text, suggestions=[])


def _wire(monkeypatch, bale):
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())


def _text(uid, t, update_id=1):
    return {"update_id": update_id, "message": {"message_id": update_id, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


@pytest.mark.asyncio
async def test_first_message_non_start_triggers_intro_and_wizard(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    # Brand-new user opens with a greeting, NOT /start.
    await handle_bale_update(_text(901, "سلام"), session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 901))).scalar_one()
    state = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert state.current_step == "city"
    from energybot.bale_adapter.home import INTRO_TEXT
    assert any(s["text"] == INTRO_TEXT for s in bale.sent)
    assert any("شهر" in s["text"] for s in bale.sent)


@pytest.mark.asyncio
async def test_returning_user_start_shows_home_not_wizard(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    # Onboard fully first.
    await handle_bale_update(_text(902, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(902, ans, i), session_factory=lambda: db_session)
    bale.sent.clear()
    # Now /start again -> home screen with reply keyboard, no new wizard step.
    await handle_bale_update(_text(902, "/start", 99), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert bale.sent[-1]["reply_markup"]["keyboard"]


@pytest.mark.asyncio
async def test_help_shows_home(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    # Make the user non-new so /help isn't swallowed by first-contact onboarding.
    await handle_bale_update(_text(903, "/start", 1), session_factory=lambda: db_session)
    bale.sent.clear()
    await handle_bale_update(_text(903, "/help", 2), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_onboarding_flow.py -v`
Expected: FAIL — first-contact interceptor not present; `/start` still re-runs wizard; `/help` returns the old text line.

- [ ] **Step 3: Add imports + helpers to `handler.py`**

In `src/energybot/bale_adapter/handler.py`, add to the model import (line 8):

```python
from energybot.core.models import User, Profile, OnboardingState
```

Add these helpers near `_send_step` (end of file):

```python
async def _has_onboarding_state(session: AsyncSession, user_id) -> bool:
    row = (await session.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
    return row is not None


async def _send_home(bale: BaleClient, chat_id: int) -> None:
    from energybot.bale_adapter.home import build_home_message
    text, markup = build_home_message()
    await bale.send_message(chat_id=chat_id, text=text, reply_markup=markup)
```

- [ ] **Step 4: Add the first-contact interceptor**

In `handle_bale_update`, inside the `if isinstance(parsed, UpdateText):` block, immediately after `text = parsed.text.strip()` (line 64):

```python
        if not await _has_onboarding_state(session, user.id):
            from energybot.bale_adapter.home import INTRO_TEXT
            await bale.send_message(chat_id=parsed.chat_id, text=INTRO_TEXT)
            step = await wizard.start(user.id)
            await _send_step(bale, parsed.chat_id, step)
            return
```

- [ ] **Step 5: Update the `/start` branch to home/resume**

Replace the `/start` branch (lines 65-68) with:

```python
        if text == "/start":
            current = await wizard.current_step(user.id)
            if current is not None:
                # Mid-wizard: resume where they left off.
                await _send_step(bale, parsed.chat_id, current)
            else:
                await _send_home(bale, parsed.chat_id)
            return
```

- [ ] **Step 6: Update the `/help` branch to home**

Replace the `/help` branch (the two lines sending the old text) with:

```python
        if text == "/help":
            await _send_home(bale, parsed.chat_id)
            return
```

- [ ] **Step 6b: Show home when the wizard completes (both code paths)**

The completion message "ممنون! حالا می‌توانم..." appears twice. In the **text** branch (line ~132-134):

```python
                if next_step is None:
                    await _send_home(bale, parsed.chat_id)
                    return
                await _send_step(bale, parsed.chat_id, next_step)
                return
```

And in the **callback** branch (line ~180-183):

```python
            if next_step is None:
                await _send_home(bale, parsed.chat_id)
            else:
                await _send_step(bale, parsed.chat_id, next_step)
```

- [ ] **Step 6c: Assert home appears at the end of onboarding**

Add to `tests/integration/test_onboarding_flow.py`:

```python
@pytest.mark.asyncio
async def test_wizard_completion_shows_home(db_session, monkeypatch):
    bale = FakeBale()
    _wire(monkeypatch, bale)
    await handle_bale_update(_text(904, "/start", 1), session_factory=lambda: db_session)
    answers = ["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"]
    for i, ans in enumerate(answers, start=2):
        await handle_bale_update(_text(904, ans, i), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert bale.sent[-1]["reply_markup"]["keyboard"]
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pytest tests/integration/test_onboarding_flow.py tests/integration/test_bot_handler.py -v`
Expected: PASS. (`test_new_user_triggers_onboarding_wizard` still passes: first-contact path also creates the `city` step and the city prompt contains "شهر".)

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/handler.py tests/integration/test_onboarding_flow.py
git commit -m "feat(bale): first-contact onboarding; /start and /help show home"
```

---

### Task 6: Reply-keyboard label router + shared command helpers

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py` (extract `_send_profile`, `_send_web`, `_send_bill_prompt`; add label router; reuse helpers in `/` branches)
- Test: `tests/integration/test_reply_keyboard.py`

**Interfaces:**
- Produces: `_send_profile(bale, session, session_factory, user, chat_id) -> None`
- Produces: `_send_web(bale, session, user, chat_id) -> None`
- Produces: `_send_bill_prompt(bale, chat_id) -> None` — sends the no-arg `/bill` prompt text.
- Consumes: `REPLY_KB_ROUTES` (Task 2), `_send_home` (Task 5).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_reply_keyboard.py`:

```python
import pytest
from energybot.bale_adapter.handler import handle_bale_update
from energybot.agent.result import AgentResult


class FakeBale:
    def __init__(self):
        self.sent = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1

    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass


class FakeAgent:
    def __init__(self): self.calls = []
    async def handle(self, text):
        self.calls.append(text)
        return AgentResult(text="پاسخ: " + text, suggestions=[])


def _text(uid, t, update_id=1):
    return {"update_id": update_id, "message": {"message_id": update_id, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


@pytest.fixture
def wired(monkeypatch):
    bale = FakeBale()
    agent = FakeAgent()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: agent)
    return bale, agent


async def _onboard(db_session, uid):
    await handle_bale_update(_text(uid, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(uid, ans, i), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_reply_kb_label_routes_to_home_not_agent(db_session, wired):
    bale, agent = wired
    await _onboard(db_session, 950)
    bale.sent.clear()
    await handle_bale_update(_text(950, "راهنما", 50), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    assert agent.calls == []  # label intercepted, never reached the agent


@pytest.mark.asyncio
async def test_reply_kb_bill_label_sends_bill_prompt(db_session, wired):
    bale, agent = wired
    await _onboard(db_session, 951)
    bale.sent.clear()
    await handle_bale_update(_text(951, "قبض من", 60), session_factory=lambda: db_session)
    assert "قبض" in bale.sent[-1]["text"]
    assert agent.calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_reply_keyboard.py -v`
Expected: FAIL — labels currently fall through to the agent (`agent.calls` non-empty / home text absent).

- [ ] **Step 3: Extract shared command helpers**

In `src/energybot/bale_adapter/handler.py`, add near the other helpers (end of file):

```python
async def _send_profile(bale, session, session_factory, user, chat_id) -> None:
    from energybot.profile.render import render_profile_summary, render_bills_line
    from energybot.billing.repository import BillingRepository
    profile_repo = ProfileRepository(session_factory=session_factory)
    p = await profile_repo.get(user.id)
    summary = render_profile_summary(p.household or {}, p.behaviour or {}, p.goals or [], p.commitments or [])
    bills = await BillingRepository(session_factory=session_factory).recent_bills(user.id, limit=6)
    line = render_bills_line([{"utility_type": b.utility_type, "amount": int(b.amount), "term": b.term} for b in bills])
    if line:
        summary = summary + "\n\n" + line
    await bale.send_message(chat_id=chat_id, text=summary)


async def _send_web(bale, session, user, chat_id) -> None:
    from energybot.user_api.tokens import mint_login_token
    from energybot.bale_adapter.web_login import build_web_login_markup
    s = get_settings()
    if not s.public_base_url:
        await bale.send_message(chat_id=chat_id, text="نسخهٔ وب هنوز پیکربندی نشده است.")
        return
    raw = await mint_login_token(session, user.id, ttl_minutes=s.web_login_token_ttl_minutes)
    url = f"{s.public_base_url.rstrip('/')}/app/auth?t={raw}"
    await bale.send_message(
        chat_id=chat_id,
        text="برای ورود به نسخهٔ وب روی دکمهٔ زیر بزن. این لینک یک‌بارمصرف است و تا چند دقیقه اعتبار دارد.",
        reply_markup=build_web_login_markup(url),
    )


async def _send_bill_prompt(bale, chat_id) -> None:
    await bale.send_message(chat_id=chat_id, text="شناسه قبض را بفرست یا عکس قبض را ارسال کن.")
```

- [ ] **Step 4: Reuse helpers in the `/web` and `/profile` branches**

Replace the body of the `/web` branch (lines 72-87) with:

```python
        if text == "/web":
            await _send_web(bale, session, user, parsed.chat_id)
            return
```

Replace the body of the `/profile` branch (lines 88-98) with:

```python
        if text == "/profile":
            await _send_profile(bale, session, session_factory, user, parsed.chat_id)
            return
```

- [ ] **Step 5: Add the label router**

In `handle_bale_update`, after the `/forget` branch and before the `if text.startswith("/bill"):` block (i.e. after line 110), add:

```python
        from energybot.bale_adapter.actions import REPLY_KB_ROUTES
        kind = REPLY_KB_ROUTES.get(text)
        if kind is not None:
            if kind == "home":
                await _send_home(bale, parsed.chat_id)
            elif kind == "profile":
                await _send_profile(bale, session, session_factory, user, parsed.chat_id)
            elif kind == "web":
                await _send_web(bale, session, user, parsed.chat_id)
            elif kind == "bill":
                await _send_bill_prompt(bale, parsed.chat_id)
            return
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/integration/test_reply_keyboard.py tests/integration/test_bot_handler.py tests/integration/test_bot_handler_billing.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/energybot/bale_adapter/handler.py tests/integration/test_reply_keyboard.py
git commit -m "feat(bale): reply-keyboard label router with shared command helpers"
```

---

### Task 7: Inline suggestions on chat replies + `act:` callback routing

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py` (render suggestions; `_reply_with_agent` helper; `act:` callback branch; `_dispatch_quick_action`)
- Test: `tests/integration/test_suggestions_flow.py`

**Interfaces:**
- Consumes: `build_suggestions_markup`, `CATALOG` (Task 2); `_send_home`, `_send_profile`, `_send_web`, `_send_bill_prompt` (Tasks 5-6).
- Produces: `_reply_with_agent(bale, user, chat_id, text, session_factory) -> None` — builds the agent, calls `handle`, sends text with inline suggestion markup; on error sends the fallback message.
- Produces: `_dispatch_quick_action(bale, session, session_factory, user, chat_id, key) -> None` — routes a catalog key by `kind`; `prompt` kind feeds the catalog prompt to `_reply_with_agent`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_suggestions_flow.py`:

```python
import pytest
from energybot.bale_adapter.handler import handle_bale_update
from energybot.agent.result import AgentResult


class FakeBale:
    def __init__(self):
        self.sent = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return 1

    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass


class FakeAgent:
    def __init__(self, suggestions):
        self._suggestions = suggestions
        self.calls = []

    async def handle(self, text):
        self.calls.append(text)
        return AgentResult(text="پاسخ: " + text, suggestions=list(self._suggestions))


def _text(uid, t, update_id=1):
    return {"update_id": update_id, "message": {"message_id": update_id, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


def _cb(uid, data, update_id=1):
    return {"update_id": update_id, "callback_query": {"id": "cb1", "from": {"id": uid},
            "message": {"message_id": 1, "chat": {"id": uid}}, "data": data}}


async def _onboard(db_session, uid):
    await handle_bale_update(_text(uid, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(uid, ans, i), session_factory=lambda: db_session)


def _wire(monkeypatch, bale, agent):
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: agent)


@pytest.mark.asyncio
async def test_chat_reply_attaches_inline_suggestions(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=["query_bill", "saving_tips"])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 960)
    bale.sent.clear()
    await handle_bale_update(_text(960, "قبض گازم چرا زیاده؟", 40), session_factory=lambda: db_session)
    last = bale.sent[-1]
    assert last["text"].startswith("پاسخ:")
    cbs = [b["callback_data"] for row in last["reply_markup"]["inline_keyboard"] for b in row]
    assert cbs == ["act:query_bill", "act:saving_tips"]


@pytest.mark.asyncio
async def test_no_suggestions_means_no_markup(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=[])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 961)
    bale.sent.clear()
    await handle_bale_update(_text(961, "سلام", 40), session_factory=lambda: db_session)
    assert bale.sent[-1]["reply_markup"] is None


@pytest.mark.asyncio
async def test_act_callback_routes_to_bill_prompt(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=[])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 962)
    bale.sent.clear()
    await handle_bale_update(_cb(962, "act:query_bill", 41), session_factory=lambda: db_session)
    assert "قبض" in bale.sent[-1]["text"]
    assert agent.calls == []  # system action, not an agent prompt


@pytest.mark.asyncio
async def test_act_callback_prompt_kind_calls_agent(db_session, monkeypatch):
    bale = FakeBale()
    agent = FakeAgent(suggestions=[])
    _wire(monkeypatch, bale, agent)
    await _onboard(db_session, 963)
    bale.sent.clear()
    await handle_bale_update(_cb(963, "act:saving_tips", 42), session_factory=lambda: db_session)
    from energybot.bale_adapter.actions import CATALOG
    assert agent.calls == [CATALOG["saving_tips"].prompt]
    assert bale.sent[-1]["text"].startswith("پاسخ:")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_suggestions_flow.py -v`
Expected: FAIL — chat replies carry no markup; `act:` callbacks are unhandled.

- [ ] **Step 3: Add `_reply_with_agent` and `_dispatch_quick_action` helpers**

In `src/energybot/bale_adapter/handler.py`, add near the other helpers (end of file):

```python
async def _reply_with_agent(bale, user, chat_id, text, session_factory) -> None:
    from energybot.bale_adapter.actions import build_suggestions_markup
    try:
        agent = build_agent_for_user(user.id, chat_id, session_factory)
        result = await agent.handle(text)
        reply_text = result.text
        markup = build_suggestions_markup(result.suggestions)
    except Exception:
        from energybot.logging import get_logger
        get_logger(__name__).exception("agent_call_failed", user_id=str(user.id), chat_id=chat_id)
        reply_text = "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"
        markup = None
    await bale.send_message(chat_id=chat_id, text=reply_text, reply_markup=markup)


async def _dispatch_quick_action(bale, session, session_factory, user, chat_id, key) -> None:
    from energybot.bale_adapter.actions import CATALOG
    action = CATALOG.get(key)
    if action is None:
        return
    if action.kind == "home":
        await _send_home(bale, chat_id)
    elif action.kind == "profile":
        await _send_profile(bale, session, session_factory, user, chat_id)
    elif action.kind == "web":
        await _send_web(bale, session, user, chat_id)
    elif action.kind == "bill":
        await _send_bill_prompt(bale, chat_id)
    elif action.kind == "prompt":
        await _reply_with_agent(bale, user, chat_id, action.prompt, session_factory)
```

- [ ] **Step 4: Route the normal chat path through `_reply_with_agent`**

Replace the chat block from Task 4 Step 7 (lines that build the agent and send `reply_text`) with:

```python
        await _reply_with_agent(bale, user, parsed.chat_id, text, session_factory)
```

- [ ] **Step 5: Add the `act:` branch to the callback handler**

In `handle_bale_update`, inside the `elif isinstance(parsed, UpdateCallback):` block, after `await bale.answer_callback_query(...)` and before the `if parsed.data.startswith("pay:"):` check (~line 165), add:

```python
        if parsed.data.startswith("act:"):
            await _dispatch_quick_action(bale, session, session_factory, user, parsed.chat_id, parsed.data[4:])
            return
```

- [ ] **Step 6: Run the full suite to verify**

Run: `pytest tests/integration/test_suggestions_flow.py tests/integration/test_bot_handler.py tests/integration/test_reply_keyboard.py tests/integration/test_onboarding_flow.py -v`
Expected: PASS.

- [ ] **Step 7: Run the whole test suite**

Run: `pytest -q`
Expected: PASS (no regressions).

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/handler.py tests/integration/test_suggestions_flow.py
git commit -m "feat(bale): inline contextual suggestions and act: callback routing"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| First-contact intro + wizard (any first text) | Task 5 |
| Home screen on wizard completion | Task 5 (wizard completion message → home: see note below) |
| Home screen on returning `/start` | Task 5 |
| `/help` → home | Task 5 |
| Persistent reply keyboard (core 4) | Task 3 + Task 6 |
| Reply-keyboard label routing | Task 6 |
| Native command menu (`setMyCommands`) | Task 1 |
| Quick-action catalog (single source of truth) | Task 2 |
| LLM `suggest_actions` tool, 0-3 keys | Task 4 |
| `agent.handle()` returns text + suggestions | Task 4 |
| Inline suggestion buttons on replies | Task 7 |
| `act:` callback routing through catalog | Task 7 |
| Invalid keys dropped | Task 2 (markup) + Task 4 (tool) |
| Agent error fallback keeps working | Task 7 (`_reply_with_agent`) |

**Wizard completion → home:** The existing completion message ("ممنون! حالا می‌توانم...") is sent in TWO places in `handler.py` (text branch and callback branch). Both are replaced with `_send_home` in Task 5 Steps 6b/6c (with a dedicated test). Covered.

**Placeholder scan:** No TBD/TODO; every code step shows complete code.

**Type consistency:** `AgentResult(text, suggestions)` defined in Task 4 and consumed identically in Tasks 5-7 and tests. `QuickAction.kind` values `{"profile","bill","web","home","prompt"}` are consistent between Task 2 (catalog), Task 6 (label router), and Task 7 (`_dispatch_quick_action`). `build_suggestions_markup`, `CATALOG`, `CATALOG_KEYS`, `REPLY_KB_ROUTES` names match across tasks. Helper signatures (`_send_profile`, `_send_web`, `_send_bill_prompt`, `_send_home`, `_reply_with_agent`, `_dispatch_quick_action`) are defined once and called with matching arguments.
