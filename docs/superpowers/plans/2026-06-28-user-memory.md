# User Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an LLM-maintained, cross-chat store of unstructured user facts (preferences, life context, constraints, interaction style) that the chat agent curates via a tool and that is injected into the agent's context.

**Architecture:** A dedicated `user_memories` table (one row per fact, short BigInteger id, soft-delete) is read/written through a `MemoryRepository`. A single `manage_memory` agent tool does add/update/remove. `ContextAssembler` renders active items into a new `user_memory` system-prompt variable. A read-only `GET /api/app/memory` endpoint plus a section on the web profile page surface the memory to the user.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy 2 (async) / Alembic / PostgreSQL (asyncpg) / pytest-asyncio; Next.js (TypeScript, App Router) for `app_ui`.

## Global Constraints

- Persian-only product. All user-facing strings and prompt copy are in Persian (Farsi).
- Memory is **separate from** structured profile data — never store household/goals/commitments facts in memory; those keep using `update_profile` / `record_commitment`.
- Fixed category taxonomy (exactly these 5 values): `preference`, `life_context`, `constraint`, `interaction_style`, `misc`.
- Soft cap of **40** active items per user — enforced as an advisory nudge, never a hard rejection.
- All repository operations are scoped by `user_id`; one user can never read or mutate another user's items.
- Follow existing patterns: repositories take `session_factory`; tools follow the `name`/`description`/`parameters`/`invoke` shape; tests live in `tests/integration/` and use the `db_session` fixture against `TEST_DATABASE_URL`.
- `source_message_id` is a plain `BigInteger` column (no FK), matching the existing `ProfileEvent.source_message_id` convention — NOT a ForeignKey. (This refines the spec, which loosely said "FK→messages"; the codebase convention is a plain column, and the agent tool wiring passes `current_message_id=None` today anyway.)

## File Structure

- `src/energybot/core/models.py` — add `UserMemory` model (modify).
- `alembic/versions/20260628_1200_user_memory.py` — create table migration (create).
- `src/energybot/memory/__init__.py` — new package (create).
- `src/energybot/memory/repository.py` — `MemoryRepository` (create).
- `src/energybot/memory/render.py` — `render_memory()` (create).
- `src/energybot/agent/tools/manage_memory.py` — `ManageMemoryTool` (create).
- `src/energybot/agent/context.py` — inject `user_memory` var (modify).
- `src/energybot/agent/builder.py` — construct repo, wire into assembler + register tool (modify).
- `scripts/seed_data/prompts/system_prompt.md` — add memory section (modify).
- `src/energybot/user_api/memory.py` — read-only endpoint (create).
- `src/energybot/main.py` — register the new router (modify).
- `tests/integration/conftest.py` — add `user_memories` to cleanup (modify).
- `app_ui/src/lib/api.ts` — `getMemory()` client (modify).
- `app_ui/src/app/profile/page.tsx` — read-only memory card (modify).

---

### Task 1: `UserMemory` model + migration

**Files:**
- Modify: `src/energybot/core/models.py` (add model near `ChatSummary`, ~line 105)
- Create: `alembic/versions/20260628_1200_user_memory.py`
- Modify: `tests/integration/conftest.py` (add cleanup for `user_memories`)
- Test: `tests/integration/test_user_memory_schema.py`

**Interfaces:**
- Produces: `UserMemory` ORM model with columns `id: int` (PK, autoincrement), `user_id: UUID`, `text: str`, `category: str`, `source_message_id: int | None`, `created_at: datetime`, `updated_at: datetime`, `deleted_at: datetime | None`. Table `user_memories`, index `ix_user_memories_user (user_id, deleted_at)`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_user_memory_schema.py`:

```python
import pytest
from sqlalchemy import select
from uuid import uuid4
from energybot.core.models import User, UserMemory


@pytest.mark.asyncio
async def test_insert_and_read_user_memory(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(UserMemory(user_id=u.id, text="اتاق خنک را دوست دارد", category="preference"))
    await db_session.commit()
    row = (await db_session.execute(
        select(UserMemory).where(UserMemory.user_id == u.id)
    )).scalar_one()
    assert row.id is not None
    assert row.text == "اتاق خنک را دوست دارد"
    assert row.category == "preference"
    assert row.deleted_at is None
    assert row.created_at is not None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_user_memory_schema.py -v`
Expected: FAIL — `ImportError: cannot import name 'UserMemory'` (and, after the model exists but before migration, a `UndefinedTable` / `relation "user_memories" does not exist` error).

- [ ] **Step 3: Add the model**

In `src/energybot/core/models.py`, immediately after the `ChatSummary` class (around line 105), add:

```python
class UserMemory(Base):
    __tablename__ = "user_memories"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(30), nullable=False)
    source_message_id: Mapped[int | None] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column()
    __table_args__ = (Index("ix_user_memories_user", "user_id", "deleted_at"),)
```

(All names used — `Mapped`, `mapped_column`, `BigInteger`, `PGUUID`, `ForeignKey`, `Text`, `String`, `func`, `Index`, `datetime`, `UUID` — are already imported in this file.)

- [ ] **Step 4: Write the migration**

Create `alembic/versions/20260628_1200_user_memory.py`:

```python
"""user memory table

Revision ID: f6a1b2c3d4e5
Revises: e5f6a1b2c3d4
Create Date: 2026-06-28 12:00:00.000000
"""
from alembic import op
import sqlalchemy as sa

revision: str = "f6a1b2c3d4e5"
down_revision: str | None = "e5f6a1b2c3d4"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "user_memories",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("category", sa.String(length=30), nullable=False),
        sa.Column("source_message_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_user_memories_user", "user_memories", ["user_id", "deleted_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_user_memories_user", table_name="user_memories")
    op.drop_table("user_memories")
```

- [ ] **Step 5: Add `user_memories` to the integration test cleanup**

In `tests/integration/conftest.py`, in BOTH the before-yield and after-yield blocks, add a delete for `user_memories` immediately before the `DELETE FROM users` line (it FK-references `users`):

```python
    await db_session.execute(text("DELETE FROM user_memories"))
    await db_session.execute(text("DELETE FROM users"))
```

- [ ] **Step 6: Apply the migration to dev and test databases**

Run:
```bash
DATABASE_URL=postgresql://energybot:energybot@localhost:5432/energybot python -m alembic upgrade head
DATABASE_URL=postgresql://energybot:energybot@localhost:5433/energybot_test python -m alembic upgrade head
```
Expected: both end with `Running upgrade e5f6a1b2c3d4 -> f6a1b2c3d4e5, user memory table`.

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/integration/test_user_memory_schema.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/energybot/core/models.py alembic/versions/20260628_1200_user_memory.py tests/integration/conftest.py tests/integration/test_user_memory_schema.py
git commit -m "feat(memory): user_memories table + migration"
```

---

### Task 2: `MemoryRepository`

**Files:**
- Create: `src/energybot/memory/__init__.py` (empty)
- Create: `src/energybot/memory/repository.py`
- Test: `tests/integration/test_memory_repository.py`

**Interfaces:**
- Consumes: `UserMemory` model (Task 1).
- Produces: `MemoryRepository(*, session_factory)` with async methods:
  - `list_active(user_id: UUID) -> list[UserMemory]` — active (not soft-deleted) items, ordered by `category` then `id`.
  - `add(user_id: UUID, text: str, category: str, source_message_id: int | None = None) -> UserMemory`
  - `update(user_id: UUID, memory_id: int, *, text: str | None = None, category: str | None = None) -> UserMemory`
  - `remove(user_id: UUID, memory_id: int) -> None` — soft-delete (set `deleted_at`).
  - `count_active(user_id: UUID) -> int`
  - Module constant `VALID_CATEGORIES: set[str]`.
  - `update`/`remove` raise `LookupError` when the id is missing/foreign/already-deleted.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_memory_repository.py`:

```python
import pytest
from uuid import uuid4
from energybot.core.models import User
from energybot.memory.repository import MemoryRepository


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_add_and_list_active(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    await repo.add(u.id, "شیفت شب کار می‌کند", "life_context")
    await repo.add(u.id, "پاسخ کوتاه می‌خواهد", "interaction_style")
    items = await repo.list_active(u.id)
    assert {i.text for i in items} == {"شیفت شب کار می‌کند", "پاسخ کوتاه می‌خواهد"}
    assert await repo.count_active(u.id) == 2


@pytest.mark.asyncio
async def test_update_changes_text_and_category(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    m = await repo.add(u.id, "اتاق خنک", "preference")
    await repo.update(u.id, m.id, text="اتاق خیلی خنک را دوست دارد", category="preference")
    items = await repo.list_active(u.id)
    assert items[0].text == "اتاق خیلی خنک را دوست دارد"


@pytest.mark.asyncio
async def test_remove_soft_deletes(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    m = await repo.add(u.id, "مستأجر است", "constraint")
    await repo.remove(u.id, m.id)
    assert await repo.list_active(u.id) == []
    assert await repo.count_active(u.id) == 0


@pytest.mark.asyncio
async def test_user_scoping_isolation(db_session):
    a = await _user(db_session)
    b = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    m = await repo.add(a.id, "متعلق به الف", "misc")
    # user b cannot see or mutate user a's item
    assert await repo.list_active(b.id) == []
    with pytest.raises(LookupError):
        await repo.update(b.id, m.id, text="نفوذ")
    with pytest.raises(LookupError):
        await repo.remove(b.id, m.id)


@pytest.mark.asyncio
async def test_update_missing_id_raises(db_session):
    u = await _user(db_session)
    repo = MemoryRepository(session_factory=lambda: db_session)
    with pytest.raises(LookupError):
        await repo.update(u.id, 999999, text="x")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_memory_repository.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.memory'`

- [ ] **Step 3: Create the package and repository**

Create empty `src/energybot/memory/__init__.py`.

Create `src/energybot/memory/repository.py`:

```python
from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import UserMemory

VALID_CATEGORIES: set[str] = {
    "preference", "life_context", "constraint", "interaction_style", "misc",
}


class MemoryRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def list_active(self, user_id: UUID) -> list[UserMemory]:
        s = self._session_factory()
        rows = (await s.execute(
            select(UserMemory)
            .where(UserMemory.user_id == user_id, UserMemory.deleted_at.is_(None))
            .order_by(UserMemory.category, UserMemory.id)
        )).scalars().all()
        return list(rows)

    async def count_active(self, user_id: UUID) -> int:
        s = self._session_factory()
        return int((await s.execute(
            select(func.count()).select_from(UserMemory)
            .where(UserMemory.user_id == user_id, UserMemory.deleted_at.is_(None))
        )).scalar_one())

    async def _get_active(self, s: AsyncSession, user_id: UUID, memory_id: int) -> UserMemory:
        row = (await s.execute(
            select(UserMemory).where(
                UserMemory.id == memory_id,
                UserMemory.user_id == user_id,
                UserMemory.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if row is None:
            raise LookupError(f"no active memory id={memory_id} for user")
        return row

    async def add(self, user_id: UUID, text: str, category: str,
                  source_message_id: int | None = None) -> UserMemory:
        if category not in VALID_CATEGORIES:
            raise ValueError(f"invalid category: {category!r}")
        s = self._session_factory()
        row = UserMemory(user_id=user_id, text=text, category=category,
                         source_message_id=source_message_id)
        s.add(row)
        await s.commit()
        await s.refresh(row)
        return row

    async def update(self, user_id: UUID, memory_id: int, *,
                     text: str | None = None, category: str | None = None) -> UserMemory:
        if category is not None and category not in VALID_CATEGORIES:
            raise ValueError(f"invalid category: {category!r}")
        s = self._session_factory()
        row = await self._get_active(s, user_id, memory_id)
        if text is not None:
            row.text = text
        if category is not None:
            row.category = category
        row.updated_at = datetime.utcnow()
        await s.commit()
        await s.refresh(row)
        return row

    async def remove(self, user_id: UUID, memory_id: int) -> None:
        s = self._session_factory()
        row = await self._get_active(s, user_id, memory_id)
        row.deleted_at = datetime.utcnow()
        await s.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_memory_repository.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/memory/__init__.py src/energybot/memory/repository.py tests/integration/test_memory_repository.py
git commit -m "feat(memory): MemoryRepository with user-scoped CRUD + soft-delete"
```

---

### Task 3: `render_memory`

**Files:**
- Create: `src/energybot/memory/render.py`
- Test: `tests/test_memory_render.py`

**Interfaces:**
- Consumes: objects with `.id: int`, `.text: str`, `.category: str` (the `UserMemory` model, but the function only touches those attributes, so tests can use the real model rows).
- Produces: `render_memory(items: list) -> str` — Persian text grouped by category with `[id]` ASCII prefixes; returns `""` for an empty list.

- [ ] **Step 1: Write the failing test**

Create `tests/test_memory_render.py`:

```python
from energybot.memory.render import render_memory


class _M:
    def __init__(self, id, text, category):
        self.id = id
        self.text = text
        self.category = category


def test_empty_returns_empty_string():
    assert render_memory([]) == ""


def test_groups_by_category_with_id_prefix():
    out = render_memory([
        _M(12, "اتاق خنک را دوست دارد", "preference"),
        _M(15, "شیفت شب کار می‌کند", "life_context"),
    ])
    assert "ترجیحات" in out
    assert "شرایط زندگی" in out
    assert "[12]" in out          # ascii id, round-trips as integer
    assert "[15]" in out
    assert "اتاق خنک را دوست دارد" in out


def test_unknown_category_falls_back_to_misc_heading():
    out = render_memory([_M(1, "چیزی", "something_weird")])
    assert "سایر" in out
    assert "چیزی" in out
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_memory_render.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.memory.render'`

- [ ] **Step 3: Implement the renderer**

Create `src/energybot/memory/render.py`:

```python
# Category -> Persian heading. Order here defines render order.
_HEADINGS = [
    ("preference", "ترجیحات"),
    ("life_context", "شرایط زندگی"),
    ("constraint", "محدودیت‌ها"),
    ("interaction_style", "سبک تعامل"),
    ("misc", "سایر"),
]
_LABEL = dict(_HEADINGS)


def render_memory(items: list) -> str:
    if not items:
        return ""
    by_cat: dict[str, list] = {}
    for it in items:
        cat = it.category if it.category in _LABEL else "misc"
        by_cat.setdefault(cat, []).append(it)
    parts: list[str] = ["آنچه درباره‌ی کاربر می‌دانم:"]
    for cat, heading in _HEADINGS:
        rows = by_cat.get(cat)
        if not rows:
            continue
        lines = [f"- [{it.id}] {it.text}" for it in rows]
        parts.append(f"{heading}:\n" + "\n".join(lines))
    return "\n\n".join(parts)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_memory_render.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/memory/render.py tests/test_memory_render.py
git commit -m "feat(memory): render active memory items to grouped Persian text"
```

---

### Task 4: `ManageMemoryTool`

**Files:**
- Create: `src/energybot/agent/tools/manage_memory.py`
- Test: `tests/integration/test_tool_manage_memory.py`

**Interfaces:**
- Consumes: `MemoryRepository` (Task 2), `VALID_CATEGORIES`.
- Produces: `ManageMemoryTool(*, repo: MemoryRepository, user_id: UUID, current_message_id: int | None)` with `name = "manage_memory"`, a `parameters` JSON schema (`action` enum add|update|remove, `text`, `category` enum, `memory_id`), and `async invoke(args) -> dict`. Module constant `MEMORY_SOFT_CAP = 40`.
- Behavior: `add` requires `text` + `category`; nudges (via `data.note`) when count ≥ `MEMORY_SOFT_CAP`. `update` requires `memory_id` plus at least one of `text`/`category`. `remove` requires `memory_id`. Validation problems raise `ValueError`; missing ids surface as `LookupError` from the repo (the AgentLoop wraps exceptions into `{"ok": False, "error": ...}`).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_tool_manage_memory.py`:

```python
import pytest
from uuid import uuid4
from energybot.core.models import User
from energybot.memory.repository import MemoryRepository
from energybot.agent.tools.manage_memory import ManageMemoryTool, MEMORY_SOFT_CAP


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    await db_session.commit()
    return u


def _tool(db_session, user_id):
    repo = MemoryRepository(session_factory=lambda: db_session)
    return ManageMemoryTool(repo=repo, user_id=user_id, current_message_id=None), repo


@pytest.mark.asyncio
async def test_add_creates_item(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    out = await tool.invoke({"action": "add", "text": "اتاق خنک", "category": "preference"})
    assert out["memory_id"] is not None
    items = await repo.list_active(u.id)
    assert items[0].text == "اتاق خنک"


@pytest.mark.asyncio
async def test_add_requires_text_and_category(db_session):
    u = await _user(db_session)
    tool, _ = _tool(db_session, u.id)
    with pytest.raises(ValueError):
        await tool.invoke({"action": "add", "text": "بدون دسته"})


@pytest.mark.asyncio
async def test_update_changes_item(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    add = await tool.invoke({"action": "add", "text": "قدیمی", "category": "misc"})
    await tool.invoke({"action": "update", "memory_id": add["memory_id"], "text": "جدید"})
    assert (await repo.list_active(u.id))[0].text == "جدید"


@pytest.mark.asyncio
async def test_remove_deletes_item(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    add = await tool.invoke({"action": "add", "text": "حذف‌شو", "category": "misc"})
    out = await tool.invoke({"action": "remove", "memory_id": add["memory_id"]})
    assert out["ok"] is True
    assert await repo.list_active(u.id) == []


@pytest.mark.asyncio
async def test_add_at_soft_cap_returns_note(db_session):
    u = await _user(db_session)
    tool, repo = _tool(db_session, u.id)
    for i in range(MEMORY_SOFT_CAP):
        await repo.add(u.id, f"مورد {i}", "misc")
    out = await tool.invoke({"action": "add", "text": "یکی بیشتر", "category": "misc"})
    assert out["memory_id"] is not None
    assert "note" in out  # nudge to consolidate
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_tool_manage_memory.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.agent.tools.manage_memory'`

- [ ] **Step 3: Implement the tool**

Create `src/energybot/agent/tools/manage_memory.py`:

```python
from typing import Any
from uuid import UUID
from energybot.memory.repository import MemoryRepository, VALID_CATEGORIES

MEMORY_SOFT_CAP = 40

_CAP_NOTE = (
    f"حافظه‌ی کاربر به سقف توصیه‌شده (~{MEMORY_SOFT_CAP} مورد) نزدیک شده؛ "
    "موارد تکراری یا قدیمی را با action=remove یا update تجمیع/پاک‌سازی کن."
)


class ManageMemoryTool:
    name = "manage_memory"
    description = (
        "مدیریت حافظه‌ی بلندمدت درباره‌ی کاربر: نکات غیرساختاریافته مثل ترجیحات، "
        "شرایط زندگی، محدودیت‌ها و سبک تعامل. برای افزودن نکته‌ی جدید action=add، "
        "برای اصلاح action=update و برای حذف action=remove را بزن. "
        "اطلاعات ساختاریافته‌ی خانه/اهداف/تعهدها را اینجا ذخیره نکن؛ آن‌ها را با "
        "update_profile و record_commitment ثبت کن."
    )
    parameters = {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["add", "update", "remove"]},
            "text": {"type": "string", "description": "متن نکته (برای add لازم است)"},
            "category": {"type": "string", "enum": sorted(VALID_CATEGORIES)},
            "memory_id": {"type": "integer", "description": "شناسه‌ی نکته (برای update/remove لازم است)"},
        },
        "required": ["action"],
    }

    def __init__(self, *, repo: MemoryRepository, user_id: UUID, current_message_id: int | None):
        self._repo = repo
        self._user_id = user_id
        self._msg_id = current_message_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        action = args.get("action")
        if action == "add":
            text = args.get("text")
            category = args.get("category")
            if not text or not category:
                raise ValueError("action=add requires both text and category")
            at_cap = await self._repo.count_active(self._user_id) >= MEMORY_SOFT_CAP
            row = await self._repo.add(self._user_id, text, category,
                                       source_message_id=self._msg_id)
            out: dict[str, Any] = {"memory_id": row.id}
            if at_cap:
                out["note"] = _CAP_NOTE
            return out
        if action == "update":
            memory_id = args.get("memory_id")
            if memory_id is None:
                raise ValueError("action=update requires memory_id")
            if args.get("text") is None and args.get("category") is None:
                raise ValueError("action=update requires text and/or category")
            row = await self._repo.update(self._user_id, memory_id,
                                          text=args.get("text"), category=args.get("category"))
            return {"memory_id": row.id}
        if action == "remove":
            memory_id = args.get("memory_id")
            if memory_id is None:
                raise ValueError("action=remove requires memory_id")
            await self._repo.remove(self._user_id, memory_id)
            return {"ok": True}
        raise ValueError(f"unknown action: {action!r}")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_tool_manage_memory.py -v`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/tools/manage_memory.py tests/integration/test_tool_manage_memory.py
git commit -m "feat(memory): manage_memory agent tool (add/update/remove + soft-cap nudge)"
```

---

### Task 5: Wire memory into context assembly + builder + system prompt

**Files:**
- Modify: `src/energybot/agent/context.py`
- Modify: `src/energybot/agent/builder.py`
- Modify: `scripts/seed_data/prompts/system_prompt.md`
- Modify: `tests/integration/test_context.py`
- Test: `tests/integration/test_context.py` (extended)

**Interfaces:**
- Consumes: `MemoryRepository` (Task 2), `render_memory` (Task 3), `ManageMemoryTool` (Task 4).
- Produces: `ContextAssembler.__init__` gains a required keyword `memory_repo: MemoryRepository`; `assemble` passes a new `user_memory` variable to the prompt loader. `build_agent` constructs a `MemoryRepository`, passes it to the assembler, and registers `ManageMemoryTool`.

- [ ] **Step 1: Update the existing context test (will fail)**

In `tests/integration/test_context.py`, update `FakePromptLoader` to read the new variable, add a `MemoryRepository` to the assembler construction, and assert the memory text reaches the prompt. Replace the file's body with:

```python
from uuid import uuid4
import pytest
from energybot.core.models import User, Profile
from energybot.profile.repository import ProfileRepository
from energybot.chat.repository import ChatRepository
from energybot.memory.repository import MemoryRepository
from energybot.agent.context import ContextAssembler


class FakePromptLoader:
    async def render(self, key, vars):
        return ("سیستم: " + vars["profile_summary"][:30] + " | " + vars["user_memory"], key, 1)


@pytest.mark.asyncio
async def test_assemble_includes_system_profile_summary_and_recent(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    chat = ChatRepository(session_factory=lambda: db_session)
    sid = await chat.session_for(u.id)
    await chat.add_message(u.id, sid, role="user", content="سلام")
    await chat.add_message(u.id, sid, role="assistant", content="درود")
    prof_repo = ProfileRepository(session_factory=lambda: db_session)
    mem_repo = MemoryRepository(session_factory=lambda: db_session)
    asm = ContextAssembler(prompt_loader=FakePromptLoader(), profile_repo=prof_repo,
                           chat_repo=chat, memory_repo=mem_repo)
    ctx = await asm.assemble(u.id, "این پیام جدید")
    assert ctx.system.startswith("سیستم:")
    assert ctx.prompt_template_key == "system_prompt"
    assert ctx.prompt_template_version == 1
    roles = [m.role for m in ctx.messages]
    assert roles == ["system", "user", "assistant", "user"]
    assert ctx.messages[-1].content == "این پیام جدید"


@pytest.mark.asyncio
async def test_assemble_injects_user_memory(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000), display_name="x")
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    await db_session.commit()
    chat = ChatRepository(session_factory=lambda: db_session)
    prof_repo = ProfileRepository(session_factory=lambda: db_session)
    mem_repo = MemoryRepository(session_factory=lambda: db_session)
    await mem_repo.add(u.id, "شیفت شب کار می‌کند", "life_context")
    asm = ContextAssembler(prompt_loader=FakePromptLoader(), profile_repo=prof_repo,
                           chat_repo=chat, memory_repo=mem_repo)
    ctx = await asm.assemble(u.id, "سلام")
    assert "شیفت شب کار می‌کند" in ctx.system
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_context.py -v`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'memory_repo'`

- [ ] **Step 3: Update `ContextAssembler`**

In `src/energybot/agent/context.py`:

Add imports near the other repo imports:
```python
from energybot.memory.render import render_memory
from energybot.memory.repository import MemoryRepository
```

Change `__init__` to accept and store `memory_repo`:
```python
    def __init__(self, *, prompt_loader: Any, profile_repo: ProfileRepository, chat_repo: ChatRepository, memory_repo: MemoryRepository, recent_n: int = 10):
        self._loader = prompt_loader
        self._profile_repo = profile_repo
        self._chat_repo = chat_repo
        self._memory_repo = memory_repo
        self._recent_n = recent_n
```

In `assemble`, load + render memory and pass it to the loader. Replace the `system_text, key, version = await self._loader.render(...)` block with:
```python
        memory_items = await self._memory_repo.list_active(user_id)
        user_memory = render_memory(memory_items)
        system_text, key, version = await self._loader.render("system_prompt", {
            "profile_summary": profile_summary,
            "rolling_summary": last_summary.text if last_summary else "",
            "user_memory": user_memory,
        })
```

- [ ] **Step 4: Update `build_agent`**

In `src/energybot/agent/builder.py`:

Add imports:
```python
from energybot.memory.repository import MemoryRepository
from energybot.agent.tools.manage_memory import ManageMemoryTool
```

After `profile_repo = ProfileRepository(...)` (line 30), add:
```python
    memory_repo = MemoryRepository(session_factory=session_factory)
```

Update the assembler construction (line 32) to pass `memory_repo`:
```python
    asm = ContextAssembler(prompt_loader=loader, profile_repo=profile_repo, chat_repo=chat_repo, memory_repo=memory_repo)
```

After the `RecordCommitmentTool` registration (line 37), add:
```python
    registry.register(ManageMemoryTool(repo=memory_repo, user_id=user_id, current_message_id=None))
```

- [ ] **Step 5: Update the seeded system prompt**

In `scripts/seed_data/prompts/system_prompt.md`:

(a) Under "## رفتار با ابزارها", after the `record_commitment` bullet, add a `manage_memory` bullet:
```markdown
- **manage_memory** — حافظه‌ی بلندمدتِ غیرساختاریافته درباره‌ی کاربر. هر وقت نکته‌ی ماندگاری فهمیدی که در داده‌های ساختاریافته (خانه/اهداف/تعهدها) جا نمی‌گیرد — مثل ترجیح‌ها («اتاق خنک را دوست دارد»)، شرایط زندگی («شیفت شب کار می‌کند»)، محدودیت‌ها («صاحبخانه اجازه‌ی تغییر کولر نمی‌دهد») یا سبک تعامل («پاسخ کوتاه می‌خواهد») — آن را با action=add ثبت کن. اگر نکته‌ای عوض شد با action=update به‌روزش کن و موارد قدیمی یا تکراری را با action=remove پاک کن. اطلاعات خانه/اهداف/تعهدها را اینجا نگذار؛ آن‌ها متعلق به update_profile و record_commitment‌اند. حافظه را زیر ~۴۰ مورد و تمیز نگه دار.
```

(b) Replace the "### خلاصه گفتگوی قبلی" block so a memory section follows it. After these existing lines:
```markdown
### خلاصه گفتگوی قبلی
{{ rolling_summary if rolling_summary else "(گفتگوی جدید — هنوز خلاصه‌ای وجود ندارد.)" }}
```
add:
```markdown

### حافظه‌ی بلندمدت درباره‌ی کاربر
{{ user_memory if user_memory else "(هنوز نکته‌ای درباره‌ی این کاربر در حافظه نیست.)" }}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/integration/test_context.py -v`
Expected: PASS (2 tests)

- [ ] **Step 7: Re-seed prompts into dev DB (new active version)**

Run:
```bash
DATABASE_URL=postgresql://energybot:energybot@localhost:5432/energybot python scripts/seed_dev.py --reset-prompts --skip models --skip kb
```
Expected: line `prompt 'system_prompt': retired vN, inserted vN+1`.

- [ ] **Step 8: Run the agent loop/builder tests to confirm nothing regressed**

Run: `pytest tests/integration/test_agent_builder.py tests/integration/test_agent_loop.py -v`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/energybot/agent/context.py src/energybot/agent/builder.py scripts/seed_data/prompts/system_prompt.md tests/integration/test_context.py
git commit -m "feat(memory): inject user_memory into agent context + register manage_memory tool"
```

---

### Task 6: Read-only web endpoint `GET /api/app/memory`

**Files:**
- Create: `src/energybot/user_api/memory.py`
- Modify: `src/energybot/main.py`
- Test: `tests/integration/test_user_memory_api.py`

**Interfaces:**
- Consumes: `MemoryRepository` (Task 2), `current_user` dependency (`energybot.user_api.auth`), `get_sessionmaker` (`energybot.core.db`).
- Produces: `GET /api/app/memory` returning `{"categories": [{"key", "label", "items": [{"id": int, "text": str}]}]}` with only non-empty categories, in the fixed taxonomy order; auth required.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_user_memory_api.py`:

```python
import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, Profile
from energybot.memory.repository import MemoryRepository
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
    db_session.add(Profile(user_id=u.id))
    raw = await mint_login_token(db_session, u.id, ttl_minutes=5)
    r = await client.post("/api/app/auth/redeem", json={"t": raw})
    return u, r.headers["x-csrf"]


@pytest.mark.asyncio
async def test_get_memory_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/memory")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_get_memory_returns_active_grouped(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 811811)
        repo = MemoryRepository(session_factory=lambda: db_session)
        await repo.add(u.id, "اتاق خنک", "preference")
        m = await repo.add(u.id, "حذف‌شده", "misc")
        await repo.remove(u.id, m.id)  # soft-deleted, must not appear
        r = await c.get("/api/app/memory")
    assert r.status_code == 200
    body = r.json()
    cats = {c["key"]: c for c in body["categories"]}
    assert "preference" in cats
    assert cats["preference"]["label"] == "ترجیحات"
    assert cats["preference"]["items"][0]["text"] == "اتاق خنک"
    # soft-deleted item's category not present
    assert "misc" not in cats
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_user_memory_api.py -v`
Expected: FAIL — 404 on `/api/app/memory` (route not registered).

- [ ] **Step 3: Create the endpoint**

Create `src/energybot/user_api/memory.py`:

```python
from fastapi import APIRouter, Depends
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.memory.repository import MemoryRepository
from energybot.memory.render import _HEADINGS

router = APIRouter(prefix="/api/app", tags=["app"])


@router.get("/memory")
async def get_memory(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        repo = MemoryRepository(session_factory=lambda: session)
        items = await repo.list_active(user.id)
    by_cat: dict[str, list] = {}
    for it in items:
        by_cat.setdefault(it.category, []).append({"id": it.id, "text": it.text})
    categories = [
        {"key": key, "label": label, "items": by_cat[key]}
        for key, label in _HEADINGS
        if by_cat.get(key)
    ]
    return {"categories": categories}
```

- [ ] **Step 4: Register the router**

In `src/energybot/main.py`:

Add an import near the other `user_api` imports (after line 24):
```python
from energybot.user_api.memory import router as user_memory_router
```

Add the registration after `app.include_router(user_dashboard_router)` (line 115):
```python
    app.include_router(user_memory_router)
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/integration/test_user_memory_api.py -v`
Expected: PASS (2 tests)

- [ ] **Step 6: Commit**

```bash
git add src/energybot/user_api/memory.py src/energybot/main.py tests/integration/test_user_memory_api.py
git commit -m "feat(memory): read-only GET /api/app/memory endpoint"
```

---

### Task 7: Read-only memory card in the web profile page

**Files:**
- Modify: `app_ui/src/lib/api.ts`
- Modify: `app_ui/src/app/profile/page.tsx`

**Interfaces:**
- Consumes: `GET /api/app/memory` (Task 6).
- Produces: `getMemory()` API client returning `MemoryGroup[]`; a read-only card rendered on the profile page.

- [ ] **Step 1: Add the API client**

In `app_ui/src/lib/api.ts`, after the `getDashboard` function (end of file), add:

```typescript
export type MemoryItem = { id: number; text: string };
export type MemoryGroup = { key: string; label: string; items: MemoryItem[] };

export async function getMemory(): Promise<MemoryGroup[]> {
  const r = await req("/memory");
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).categories;
}
```

- [ ] **Step 2: Render a read-only memory card on the profile page**

In `app_ui/src/app/profile/page.tsx`:

(a) Extend the `lucide-react` import (line 3) to include `Brain`:
```typescript
import { Home, Target, Handshake, Sparkles, Plus, X, AlertCircle, Brain } from "lucide-react";
```

(b) Extend the api import (lines 12-18) to include `getMemory` and the type:
```typescript
import {
  getProfile,
  patchProfile,
  addProfileItem,
  removeProfileItem,
  getMemory,
  type ProfileData,
  type MemoryGroup,
} from "@/lib/api";
```

(c) Add memory state and load it. After `const [commitText, setCommitText] = useState("");` (line 35) add:
```typescript
  const [memory, setMemory] = useState<MemoryGroup[]>([]);
```
And extend the effect (lines 37-39) to also load memory:
```typescript
  useEffect(() => {
    getProfile().then(setP).catch(() => {});
    getMemory().then(setMemory).catch(() => {});
  }, []);
```

(d) Render the card. Immediately before the closing `</div>` that ends the page content (the `</div>` on line 188, just before `</AppShell>`), insert:
```tsx
        {/* what the assistant remembers */}
        {memory.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="h-4 w-4 text-muted-foreground" />
                آنچه دستیار درباره‌ی شما به خاطر دارد
              </CardTitle>
              <CardDescription>به‌صورت خودکار از گفتگوها یاد گرفته شده</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {memory.map((g) => (
                <div key={g.key} className="space-y-2">
                  <p className="text-sm font-medium text-muted-foreground">{g.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {g.items.map((it) => (
                      <span key={it.id} className="inline-flex rounded-full bg-muted px-3 py-1 text-sm">
                        {it.text}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
```

- [ ] **Step 3: Verify the app builds**

Run: `cd app_ui && npm run build`
Expected: build succeeds with no type errors. (If `npm` is unavailable in the environment, run `cd app_ui && npx tsc --noEmit` to type-check.)

- [ ] **Step 4: Commit**

```bash
git add app_ui/src/lib/api.ts app_ui/src/app/profile/page.tsx
git commit -m "feat(memory): read-only memory card on web profile page"
```

---

## Final verification

- [ ] Run the full backend suite: `pytest -q`
  Expected: all tests pass (including the new memory tests and the unchanged existing suite).
- [ ] Confirm migration round-trips: `DATABASE_URL=postgresql://energybot:energybot@localhost:5433/energybot_test python -m alembic downgrade -1 && DATABASE_URL=postgresql://energybot:energybot@localhost:5433/energybot_test python -m alembic upgrade head`
  Expected: downgrade drops `user_memories`, upgrade recreates it, no errors.
