# Onboarding Flow Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the Bale onboarding into a benefits-forward, resumable sequence — intro → profile wizard → multi-select intent → first-bill prompt → toolbox of service preferences → home — with free chat available throughout.

**Architecture:** The existing 7-step `WizardEngine` keeps owning the profile Q&A but no longer *completes* onboarding at its end; instead it hands off to three new post-wizard phases (`motivations`, `first_bill`, `toolbox`) tracked by sentinel values in `OnboardingState.current_step`. A new `onboarding/flow.py` centralizes phase + draft-selection state; a new `bale_adapter/multiselect.py` renders reusable toggle keyboards. The handler gains a phase dispatcher. `completed_at` is set only when the toolbox step is committed or skipped.

**Tech Stack:** Python 3.10+, FastAPI, SQLAlchemy 2.0 async, asyncpg/Postgres, Alembic, pytest + pytest-asyncio. Bale Bot API (Telegram-compatible).

## Global Constraints

- **Persian-only** user-facing copy; no i18n framework — strings are inline literals / small constant modules.
- **Persian digits** in user-facing copy where numerals appear (۱۲ not 12); minimal emoji; no tables/heavy markdown (Bale renders them poorly).
- **Onboarding tone** is informal/friendly (matches existing `INTRO_TEXT`/`HOME_TEXT`); the agent chat persona (formal «شما») is unchanged and out of scope.
- **"Onboarded?"** is now `OnboardingState.completed_at IS NOT NULL` (NOT row-presence).
- **One `reply_markup` per message** (Bale/Telegram limit).
- **Capture preferences only** — no reminder/scheduled-outbound delivery is built.
- **Bills self-identify** their utility type via barcode; the برق/گاز buttons are guidance only, never classification.
- Tests run against a live Postgres (`TEST_DATABASE_URL`, default `energybot_test`); schema comes from `alembic upgrade head`, NOT `create_all`. Any model/column change requires a migration applied to the test DB before its tests pass.
- Migration current head is `a7b8c9d0e1f2` (`20260630_1300_incentives.py`).
- Run the suite with `pytest` from repo root.

---

### Task 1: `Profile.service_prefs` column, migration, and repository setter

**Files:**
- Modify: `src/energybot/core/models.py:26-37` (Profile model)
- Create: `alembic/versions/20260712_1400_profile_service_prefs.py`
- Modify: `src/energybot/profile/repository.py` (add `set_service_prefs`)
- Test: `tests/integration/test_profile_service_prefs.py`

**Interfaces:**
- Produces: `Profile.service_prefs: list` (JSONB, default `[]`); `ProfileRepository.set_service_prefs(user_id: UUID, keys: list[str], *, source: str, reason: str) -> None`.

- [ ] **Step 1: Add the column to the model**

In `src/energybot/core/models.py`, inside `class Profile`, add after the `commitments` line (line 34):

```python
    service_prefs: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
```

- [ ] **Step 2: Write the Alembic migration**

Create `alembic/versions/20260712_1400_profile_service_prefs.py`:

```python
"""profile service_prefs column

Revision ID: b1c2d3e4f5a6
Revises: a7b8c9d0e1f2
Create Date: 2026-07-12 14:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "b1c2d3e4f5a6"
down_revision: str | None = "a7b8c9d0e1f2"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "profiles",
        sa.Column(
            "service_prefs",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'[]'::jsonb"),
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("profiles", "service_prefs")
```

- [ ] **Step 3: Apply the migration to the test database**

Run: `alembic upgrade head`
Expected: ends at revision `b1c2d3e4f5a6` with no error. (If `alembic` targets a different URL than the test DB, run it against `TEST_DATABASE_URL` too, e.g. `DATABASE_URL=$TEST_DATABASE_URL alembic upgrade head`.)

- [ ] **Step 4: Write the failing test**

Create `tests/integration/test_profile_service_prefs.py`:

```python
import pytest
from sqlalchemy import select
from energybot.core.models import User, Profile, ProfileEvent
from energybot.profile.repository import ProfileRepository


async def _make_user(session) -> User:
    u = User(bale_user_id=7001, display_name="t")
    session.add(u)
    await session.flush()
    session.add(Profile(user_id=u.id))
    await session.commit()
    return u


@pytest.mark.asyncio
async def test_set_service_prefs_persists_and_logs(db_session):
    u = await _make_user(db_session)
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.set_service_prefs(u.id, ["daily_reminder", "weekly_summary"], source="onboarding", reason="onboarding:toolbox")
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.service_prefs == ["daily_reminder", "weekly_summary"]
    ev = (await db_session.execute(select(ProfileEvent).where(ProfileEvent.field_path == "service_prefs"))).scalars().all()
    assert ev and ev[-1].after == {"value": ["daily_reminder", "weekly_summary"]}
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pytest tests/integration/test_profile_service_prefs.py -v`
Expected: FAIL — `AttributeError: 'ProfileRepository' object has no attribute 'set_service_prefs'`.

- [ ] **Step 6: Implement the setter**

In `src/energybot/profile/repository.py`, add this method to `ProfileRepository` (after `append`):

```python
    async def set_service_prefs(self, user_id: UUID, keys: list[str], *, source: str, reason: str) -> None:
        s = self._session_factory()
        p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()
        before = list(p.service_prefs or [])
        p.service_prefs = list(keys)
        s.add(ProfileEvent(
            user_id=user_id, field_path="service_prefs",
            before={"value": before}, after={"value": list(keys)},
            source=source, reason=reason,
        ))
        await s.commit()
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pytest tests/integration/test_profile_service_prefs.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/energybot/core/models.py alembic/versions/20260712_1400_profile_service_prefs.py src/energybot/profile/repository.py tests/integration/test_profile_service_prefs.py
git commit -m "feat(profile): add service_prefs column + repository setter"
```

---

### Task 2: Reusable multi-select keyboard widget

**Files:**
- Create: `src/energybot/bale_adapter/multiselect.py`
- Test: `tests/unit/test_multiselect.py`

**Interfaces:**
- Produces:
  - `build_markup(field: str, options: list[tuple[str, str]], selected, *, allow_skip: bool = False, done_label: str = "تأیید ✅", skip_label: str = "فعلاً نه") -> dict` — returns an `inline_keyboard` markup. Each option row shows `✅ <label>` when selected else `▫️ <label>`, `callback_data=f"ms:{field}:{key}"`. Trailing control row has a done button (`ms:{field}:__done__`) and, when `allow_skip`, a skip button (`ms:{field}:__skip__`).
  - `parse_ms_callback(data: str) -> tuple[str, str] | None` — `("ms:field:key")` → `(field, key)`; `key` may be a real key or `__done__`/`__skip__`. Returns `None` when `data` isn't an `ms:` callback or is malformed.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/test_multiselect.py`:

```python
from energybot.bale_adapter.multiselect import build_markup, parse_ms_callback

OPTS = [("a", "الف"), ("b", "ب")]


def test_build_markup_marks_selected_and_adds_done():
    m = build_markup("tb", OPTS, {"a"})
    rows = m["inline_keyboard"]
    assert rows[0][0]["text"].startswith("✅ ") and rows[0][0]["text"].endswith("الف")
    assert rows[0][0]["callback_data"] == "ms:tb:a"
    assert rows[1][0]["text"].startswith("▫️ ")
    control = rows[-1]
    assert control[0]["callback_data"] == "ms:tb:__done__"
    assert all("__skip__" not in b["callback_data"] for b in control)


def test_build_markup_optional_skip():
    m = build_markup("tb", OPTS, set(), allow_skip=True)
    control = m["inline_keyboard"][-1]
    assert control[-1]["callback_data"] == "ms:tb:__skip__"


def test_parse_ms_callback():
    assert parse_ms_callback("ms:tb:a") == ("tb", "a")
    assert parse_ms_callback("ms:motivations:__done__") == ("motivations", "__done__")
    assert parse_ms_callback("act:foo") is None
    assert parse_ms_callback("ms:tb:") is None
    assert parse_ms_callback("ms::x") is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_multiselect.py -v`
Expected: FAIL — `ModuleNotFoundError: energybot.bale_adapter.multiselect`.

- [ ] **Step 3: Implement the widget**

Create `src/energybot/bale_adapter/multiselect.py`:

```python
from collections.abc import Iterable


def build_markup(
    field: str,
    options: list[tuple[str, str]],
    selected: Iterable[str],
    *,
    allow_skip: bool = False,
    done_label: str = "تأیید ✅",
    skip_label: str = "فعلاً نه",
) -> dict:
    sel = set(selected)
    rows = []
    for key, label in options:
        mark = "✅ " if key in sel else "▫️ "
        rows.append([{"text": mark + label, "callback_data": f"ms:{field}:{key}"}])
    control = [{"text": done_label, "callback_data": f"ms:{field}:__done__"}]
    if allow_skip:
        control.append({"text": skip_label, "callback_data": f"ms:{field}:__skip__"})
    rows.append(control)
    return {"inline_keyboard": rows}


def parse_ms_callback(data: str) -> tuple[str, str] | None:
    if not data.startswith("ms:"):
        return None
    field, _, key = data[3:].partition(":")
    if not field or not key:
        return None
    return field, key
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/unit/test_multiselect.py -v`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/energybot/bale_adapter/multiselect.py tests/unit/test_multiselect.py
git commit -m "feat(bale): reusable multi-select inline keyboard widget"
```

---

### Task 3: Callback `message_id` + `editMessageReplyMarkup` client method

**Files:**
- Modify: `src/energybot/bale_adapter/parser.py:14-21` (UpdateCallback) and `:85-93` (construction)
- Modify: `src/energybot/bale_adapter/client.py` (add `edit_message_reply_markup`)
- Test: `tests/unit/test_parser_callback_message_id.py`

**Interfaces:**
- Produces: `UpdateCallback.message_id: int | None`; `BaleClient.edit_message_reply_markup(*, chat_id: int, message_id: int, reply_markup: dict) -> None`.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/test_parser_callback_message_id.py`:

```python
from energybot.bale_adapter.parser import parse_update, UpdateCallback


def test_callback_carries_message_id():
    upd = parse_update({
        "update_id": 5,
        "callback_query": {
            "id": "cb1", "from": {"id": 42},
            "message": {"message_id": 77, "chat": {"id": 42}},
            "data": "ms:tb:a",
        },
    })
    assert isinstance(upd, UpdateCallback)
    assert upd.message_id == 77


def test_callback_without_message_id_is_none():
    upd = parse_update({
        "update_id": 5,
        "callback_query": {"id": "cb1", "from": {"id": 42}, "data": "x"},
    })
    assert isinstance(upd, UpdateCallback)
    assert upd.message_id is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/unit/test_parser_callback_message_id.py -v`
Expected: FAIL — `TypeError: __init__() missing ... 'message_id'` or `AttributeError`.

- [ ] **Step 3: Add `message_id` to `UpdateCallback`**

In `src/energybot/bale_adapter/parser.py`, replace the `UpdateCallback` dataclass (lines 14-21):

```python
@dataclass(slots=True)
class UpdateCallback:
    update_id: int
    bale_user_id: int
    chat_id: int
    callback_id: str
    data: str
    message_id: int | None
```

And in `parse_update`, replace the `callback_query` construction (lines 86-93):

```python
    if "callback_query" in d:
        c = d["callback_query"]
        return UpdateCallback(
            update_id=int(upd),
            bale_user_id=int(c["from"]["id"]),
            chat_id=int(c.get("message", {}).get("chat", {}).get("id", c["from"]["id"])),
            callback_id=str(c["id"]),
            data=str(c.get("data", "")),
            message_id=(c.get("message", {}) or {}).get("message_id"),
        )
```

- [ ] **Step 4: Add the client method**

In `src/energybot/bale_adapter/client.py`, add after `answer_callback_query` (line 39):

```python
    async def edit_message_reply_markup(self, *, chat_id: int, message_id: int, reply_markup: dict) -> None:
        await self._post_json("editMessageReplyMarkup", {
            "chat_id": chat_id, "message_id": message_id, "reply_markup": reply_markup,
        })
```

- [ ] **Step 5: Run test + full parser tests to verify pass**

Run: `pytest tests/unit/test_parser_callback_message_id.py -v && pytest tests/ -k parser -v`
Expected: PASS; no other parser test regresses.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/bale_adapter/parser.py src/energybot/bale_adapter/client.py tests/unit/test_parser_callback_message_id.py
git commit -m "feat(bale): callback message_id + editMessageReplyMarkup"
```

---

### Task 4: Onboarding phase/state module + content constants

**Files:**
- Create: `src/energybot/onboarding/__init__.py`
- Create: `src/energybot/onboarding/flow.py`
- Create: `src/energybot/onboarding/content.py`
- Test: `tests/integration/test_onboarding_flow_state.py`

**Interfaces:**
- Produces (`flow`): constants `PHASE_PROFILE`, `PHASE_MOTIVATIONS`, `PHASE_FIRST_BILL`, `PHASE_TOOLBOX`, `STEP_MOTIVATIONS`, `STEP_FIRST_BILL`, `STEP_TOOLBOX`; and coroutines
  - `load_state(session, user_id) -> OnboardingState | None`
  - `active_phase(state) -> str | None` (None when state absent or completed; `PHASE_PROFILE` for a real wizard step; else the sentinel's phase)
  - `set_step(session_factory, user_id, step) -> None`
  - `complete(session_factory, user_id) -> None`
  - `get_draft(session_factory, user_id, field) -> list[str]`
  - `seed_draft(session_factory, user_id, field, keys) -> None`
  - `toggle_draft(session_factory, user_id, field, key) -> list[str]`
  - `clear_draft(session_factory, user_id, field) -> None`
- Produces (`content`): `MOTIVATION_OPTIONS`, `TOOLBOX_OPTIONS` (`list[tuple[str,str]]`), and the prompt/help strings named below.

- [ ] **Step 1: Create the package init**

Create `src/energybot/onboarding/__init__.py`:

```python
```
(empty file)

- [ ] **Step 2: Write the content constants**

Create `src/energybot/onboarding/content.py`:

```python
# Persian, informal/friendly onboarding copy. Bills self-identify via barcode;
# the برق/گاز choices are guidance only.

MOTIVATIONS_PROMPT = (
    "یه سؤال آخر 🙂 چرا می‌خوای مصرف انرژی‌ت رو کم کنی؟\n"
    "می‌تونی چند مورد انتخاب کنی، بعد «تأیید» رو بزن."
)

MOTIVATION_OPTIONS = [
    ("help_country", "به کشورم کمک کنم"),
    ("reduce_bill", "قبضم رو کم کنم"),
    ("earn_rewards", "جایزه و پاداش بگیرم"),
]

FIRST_BILL_PROMPT = (
    "بریم سراغ اولین قبضت؟ 🔎\n"
    "قبض برق یا گاز رو انتخاب کن، یا اگه الان دم دستت نیست فعلاً رد کن."
)
FIRST_BILL_ELEC_HELP = "باشه! عکس یا فایل PDF قبض برق رو بفرست، یا شناسه قبض رو تایپ کن. ⚡"
FIRST_BILL_GAS_HELP = "باشه! عکس یا فایل PDF قبض گاز رو بفرست، یا شناسه قبض رو تایپ کن. 🔥"

TOOLBOX_PROMPT = (
    "چطور دوست داری کمکت کنم؟ چند مورد رو انتخاب کن و «تأیید» رو بزن.\n"
    "هر وقت خواستی می‌تونی از «ابزارها» عوضش کنی."
)

TOOLBOX_OPTIONS = [
    ("daily_reminder", "یادآوری روزانه"),
    ("cost_suggestions", "پیشنهاد کاهش هزینه"),
    ("reduce_help", "راهنمایی برای کم‌کردن مصرف"),
    ("weekly_summary", "خلاصهٔ هفتگی قبض و مصرف"),
    ("peak_alert", "هشدار ساعت اوج مصرف"),
    ("seasonal_tips", "نکات فصلی"),
]

TOOLBOX_UPDATED = "ابزارهات به‌روزرسانی شد ✅"
```

- [ ] **Step 3: Write the flow module**

Create `src/energybot/onboarding/flow.py`:

```python
from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from energybot.core.models import OnboardingState

PHASE_PROFILE = "profile"
PHASE_MOTIVATIONS = "motivations"
PHASE_FIRST_BILL = "first_bill"
PHASE_TOOLBOX = "toolbox"

STEP_MOTIVATIONS = "__motivations__"
STEP_FIRST_BILL = "__first_bill__"
STEP_TOOLBOX = "__toolbox__"

_SENTINEL_TO_PHASE = {
    STEP_MOTIVATIONS: PHASE_MOTIVATIONS,
    STEP_FIRST_BILL: PHASE_FIRST_BILL,
    STEP_TOOLBOX: PHASE_TOOLBOX,
}


async def load_state(session: AsyncSession, user_id: UUID) -> OnboardingState | None:
    return (await session.execute(
        select(OnboardingState).where(OnboardingState.user_id == user_id)
    )).scalar_one_or_none()


def active_phase(state: OnboardingState | None) -> str | None:
    if state is None or state.completed_at is not None:
        return None
    return _SENTINEL_TO_PHASE.get(state.current_step, PHASE_PROFILE)


async def _get(session_factory: Callable[[], AsyncSession], user_id: UUID) -> OnboardingState:
    s = session_factory()
    return (await s.execute(
        select(OnboardingState).where(OnboardingState.user_id == user_id)
    )).scalar_one()


async def set_step(session_factory, user_id: UUID, step: str) -> None:
    s = session_factory()
    st = await _get(session_factory, user_id)
    st.current_step = step
    await s.commit()


async def complete(session_factory, user_id: UUID) -> None:
    s = session_factory()
    st = await _get(session_factory, user_id)
    if st.completed_at is None:
        st.completed_at = datetime.utcnow()
        await s.commit()


def _draft_key(field: str) -> str:
    return f"{field}_draft"


async def get_draft(session_factory, user_id: UUID, field: str) -> list[str]:
    st = await _get(session_factory, user_id)
    return list(st.answers.get(_draft_key(field), []))


async def seed_draft(session_factory, user_id: UUID, field: str, keys) -> None:
    s = session_factory()
    st = await _get(session_factory, user_id)
    st.answers = {**st.answers, _draft_key(field): list(keys)}
    await s.commit()


async def toggle_draft(session_factory, user_id: UUID, field: str, key: str) -> list[str]:
    s = session_factory()
    st = await _get(session_factory, user_id)
    cur = list(st.answers.get(_draft_key(field), []))
    if key in cur:
        cur.remove(key)
    else:
        cur.append(key)
    st.answers = {**st.answers, _draft_key(field): cur}
    await s.commit()
    return cur


async def clear_draft(session_factory, user_id: UUID, field: str) -> None:
    s = session_factory()
    st = await _get(session_factory, user_id)
    a = dict(st.answers)
    a.pop(_draft_key(field), None)
    st.answers = a
    await s.commit()
```

- [ ] **Step 4: Write the failing test**

Create `tests/integration/test_onboarding_flow_state.py`:

```python
import pytest
from energybot.core.models import User, OnboardingState
from energybot.onboarding import flow


async def _state(session, current_step="city", completed=False):
    u = User(bale_user_id=8001, display_name="t")
    session.add(u)
    await session.flush()
    st = OnboardingState(user_id=u.id, current_step=current_step, answers={})
    if completed:
        from datetime import datetime
        st.completed_at = datetime.utcnow()
    session.add(st)
    await session.commit()
    return u


@pytest.mark.asyncio
async def test_active_phase_maps_steps(db_session):
    u = await _state(db_session, current_step="city")
    st = await flow.load_state(db_session, u.id)
    assert flow.active_phase(st) == flow.PHASE_PROFILE
    st.current_step = flow.STEP_FIRST_BILL
    await db_session.commit()
    st = await flow.load_state(db_session, u.id)
    assert flow.active_phase(st) == flow.PHASE_FIRST_BILL


@pytest.mark.asyncio
async def test_active_phase_none_when_completed(db_session):
    u = await _state(db_session, completed=True)
    st = await flow.load_state(db_session, u.id)
    assert flow.active_phase(st) is None


@pytest.mark.asyncio
async def test_draft_toggle_and_clear(db_session):
    u = await _state(db_session)
    sf = lambda: db_session
    assert await flow.toggle_draft(sf, u.id, "toolbox", "daily_reminder") == ["daily_reminder"]
    assert await flow.toggle_draft(sf, u.id, "toolbox", "weekly_summary") == ["daily_reminder", "weekly_summary"]
    assert await flow.toggle_draft(sf, u.id, "toolbox", "daily_reminder") == ["weekly_summary"]
    assert await flow.get_draft(sf, u.id, "toolbox") == ["weekly_summary"]
    await flow.clear_draft(sf, u.id, "toolbox")
    assert await flow.get_draft(sf, u.id, "toolbox") == []


@pytest.mark.asyncio
async def test_complete_sets_timestamp(db_session):
    u = await _state(db_session, current_step=flow.STEP_TOOLBOX)
    sf = lambda: db_session
    await flow.complete(sf, u.id)
    st = await flow.load_state(db_session, u.id)
    assert st.completed_at is not None
    assert flow.active_phase(st) is None
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/integration/test_onboarding_flow_state.py -v`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add src/energybot/onboarding/ tests/integration/test_onboarding_flow_state.py
git commit -m "feat(onboarding): phase/draft state module + content constants"
```

---

### Task 5: Motivations phase — new intro, wizard hand-off, dispatcher scaffold

This task rewrites `INTRO_TEXT`, stops the wizard from completing onboarding (it now transitions to the `motivations` sentinel), makes `/start` phase-aware, and wires the motivations multi-select. The onboarding chain temporarily terminates by completing + showing home right after the motivations commit; Tasks 6–7 extend it.

**Files:**
- Modify: `src/energybot/bale_adapter/home.py:1-6` (INTRO_TEXT)
- Modify: `src/energybot/profile/wizard.py:81-88` (current_step guard) and `:96-111` (answer hand-off)
- Modify: `src/energybot/bale_adapter/handler.py` (dispatcher, motivations widget, `ms:` callback, `/start` phase-aware)
- Modify: `tests/integration/test_onboarding_flow.py` (existing completion tests now walk through motivations)
- Test: `tests/integration/test_onboarding_motivations.py`

**Interfaces:**
- Consumes: `onboarding.flow`, `onboarding.content`, `bale_adapter.multiselect`, `ProfileRepository.set`.
- Produces (handler-internal): `_enter_motivations(bale, session_factory, user_id, chat_id)`, `_handle_multiselect(bale, session, session_factory, profile_repo, user, parsed, data)`, `_resend_phase(bale, session_factory, wizard, user_id, chat_id, phase)`.

- [ ] **Step 1: Rewrite `INTRO_TEXT`**

In `src/energybot/bale_adapter/home.py`, replace `INTRO_TEXT` (lines 1-6):

```python
INTRO_TEXT = (
    "سلام! 👋 من دستیار انرژی‌ت هستم.\n"
    "کارم اینه که کمکت کنم قبض برق و گازت رو کم کنی، توی مصرف انرژی هوشمندتر بشی، "
    "و در کنارش جایزه و امتیاز بگیری — هم جیبت خوشحال می‌شه، هم به کشورت کمک می‌کنی. 💡💰\n"
    "بیا اول یه پروفایل کوتاه بسازیم تا بتونم دقیق‌تر کمکت کنم. آماده‌ای؟ 🚀"
)
```

- [ ] **Step 2: Make the wizard hand off instead of completing**

In `src/energybot/profile/wizard.py`, in `current_step` (lines 81-88), guard the sentinel steps. Replace the body:

```python
    async def current_step(self, user_id: UUID) -> WizardStep | None:
        s = self._session_factory()
        state = (await s.execute(select(OnboardingState).where(OnboardingState.user_id == user_id))).scalar_one_or_none()
        if state is None or state.completed_at is not None:
            return None
        if state.current_step not in _STEP_BY_KEY:
            return None
        cur = _STEP_BY_KEY[state.current_step]
        return WizardStep(key=cur.key, prompt=cur.prompt, buttons=cur.buttons)
```

In `answer` (lines 104-111), replace the tail that completes onboarding:

```python
        idx = STEPS.index(cur)
        if idx + 1 < len(STEPS):
            state.current_step = STEPS[idx + 1].key
            await s.commit()
            nxt = STEPS[idx + 1]
            return WizardStep(key=nxt.key, prompt=nxt.prompt, buttons=nxt.buttons)
        from energybot.onboarding.flow import STEP_MOTIVATIONS
        state.current_step = STEP_MOTIVATIONS
        await s.commit()
        return None
```

- [ ] **Step 3: Add handler helpers for the motivations phase**

In `src/energybot/bale_adapter/handler.py`, add these functions near the other `_send_*` helpers (e.g. after `_send_home`):

```python
async def _enter_motivations(bale, session_factory, user_id, chat_id) -> None:
    from energybot.bale_adapter.multiselect import build_markup
    from energybot.onboarding import content
    markup = build_markup("motivations", content.MOTIVATION_OPTIONS, [], allow_skip=False)
    await bale.send_message(chat_id=chat_id, text=content.MOTIVATIONS_PROMPT, reply_markup=markup)


async def _resend_phase(bale, session_factory, wizard, user_id, chat_id, phase) -> None:
    from energybot.onboarding import flow
    if phase == flow.PHASE_PROFILE:
        step = await wizard.current_step(user_id)
        if step is not None:
            await _send_step(bale, chat_id, step)
    elif phase == flow.PHASE_MOTIVATIONS:
        await _enter_motivations(bale, session_factory, user_id, chat_id)


async def _handle_multiselect(bale, session, session_factory, profile_repo, user, parsed, data) -> None:
    from energybot.bale_adapter.multiselect import parse_ms_callback, build_markup
    from energybot.onboarding import flow, content
    got = parse_ms_callback(data)
    if got is None:
        return
    field, key = got
    options = {"motivations": content.MOTIVATION_OPTIONS, "toolbox": content.TOOLBOX_OPTIONS}.get(field)
    prompt = {"motivations": content.MOTIVATIONS_PROMPT, "toolbox": content.TOOLBOX_PROMPT}.get(field)
    if options is None:
        return
    if key == "__done__":
        selected = await flow.get_draft(session_factory, user.id, field)
        if field == "motivations":
            await profile_repo.set(user.id, "behaviour.motivations", selected, source="wizard", reason="onboarding:motivations")
            await flow.clear_draft(session_factory, user.id, field)
            # TEMPORARY terminal for Task 5; Task 6 replaces this with _enter_first_bill.
            await flow.complete(session_factory, user.id)
            await _send_home(bale, parsed.chat_id)
        return
    if key == "__skip__":
        return
    selected = await flow.toggle_draft(session_factory, user.id, field, key)
    st = await flow.load_state(session, user.id)
    allow_skip = field == "toolbox" and flow.active_phase(st) is not None
    markup = build_markup(field, options, selected, allow_skip=allow_skip)
    if parsed.message_id is not None:
        try:
            await bale.edit_message_reply_markup(chat_id=parsed.chat_id, message_id=parsed.message_id, reply_markup=markup)
            return
        except Exception:  # noqa: BLE001 — stale/old message: fall back to a fresh one
            pass
    await bale.send_message(chat_id=parsed.chat_id, text=prompt, reply_markup=markup)
```

- [ ] **Step 4: Make `/start` phase-aware and route wizard completion into motivations**

In `handle_bale_update`, replace the `/start` block (current lines 93-100):

```python
        if text == "/start":
            from energybot.onboarding import flow
            st = await flow.load_state(session, user.id)
            phase = flow.active_phase(st)
            if phase is None:
                await _send_home(bale, parsed.chat_id)
            else:
                await _resend_phase(bale, session_factory, wizard, user.id, parsed.chat_id, phase)
            return
```

Replace the wizard-answer block (current lines 144-154) with a phase-aware block:

```python
        from energybot.onboarding import flow
        st = await flow.load_state(session, user.id)
        phase = flow.active_phase(st)
        if phase == flow.PHASE_PROFILE:
            if is_wizard_answer(text):
                next_step = await wizard.answer(user.id, text)
                if next_step is None:
                    await _enter_motivations(bale, session_factory, user.id, parsed.chat_id)
                    return
                await _send_step(bale, parsed.chat_id, next_step)
                return
            else:
                await wizard.abandon(user.id)
        elif phase == flow.PHASE_MOTIVATIONS:
            if is_wizard_answer(text):
                await _enter_motivations(bale, session_factory, user.id, parsed.chat_id)
                return
            # a real question falls through to the agent; phase is retained
```

In the callback branch, replace the trailing wizard-answer fallback (current lines 199-206) so completion enters motivations, and add the `ms:` handler *before* it:

```python
        if parsed.data.startswith("ms:"):
            await _handle_multiselect(bale, session, session_factory, profile_repo, user, parsed, parsed.data)
            return
        current = await wizard.current_step(user.id)
        if current is not None:
            next_step = await wizard.answer(user.id, parsed.data)
            if next_step is None:
                await _enter_motivations(bale, session_factory, user.id, parsed.chat_id)
            else:
                await _send_step(bale, parsed.chat_id, next_step)
```

- [ ] **Step 5: Update the existing completion tests to walk through motivations**

In `tests/integration/test_onboarding_flow.py`, extend `FakeBale` with the new client method and a message-id counter. Replace the `FakeBale` class:

```python
class FakeBale:
    def __init__(self):
        self.sent = []
        self._mid = 0

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self._mid += 1
        self.sent.append({"chat_id": chat_id, "text": text, "reply_markup": reply_markup})
        return self._mid

    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass
    async def edit_message_reply_markup(self, *, chat_id, message_id, reply_markup):
        self.sent.append({"chat_id": chat_id, "text": None, "reply_markup": reply_markup, "edit": message_id})
```

In `test_returning_user_start_shows_home_not_wizard` and `test_wizard_completion_shows_home` and `test_wizard_completion_via_callback_shows_home`, after the 7 wizard answers add a motivations commit before asserting home. Add this helper at module top and call it right after the loop that answers the 7 steps, before `bale.sent.clear()` / the HOME assertion:

```python
async def _commit_motivations(db_session, uid, update_id):
    # Select one motivation, then press "تأیید".
    await handle_bale_update(_cb(uid, "ms:motivations:reduce_bill", update_id), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ms:motivations:__done__", update_id + 1), session_factory=lambda: db_session)
```

- In `test_wizard_completion_shows_home`: after the answers loop, insert `await _commit_motivations(db_session, 904, 20)` before the HOME assertion.
- In `test_wizard_completion_via_callback_shows_home`: after the callback answers loop, insert `await _commit_motivations(db_session, 905, 20)` before the HOME assertion.
- In `test_returning_user_start_shows_home_not_wizard`: after the answers loop, insert `await _commit_motivations(db_session, 902, 20)` before `bale.sent.clear()`.

- [ ] **Step 6: Write the motivations phase test**

Create `tests/integration/test_onboarding_motivations.py`:

```python
import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, Profile
from energybot.agent.result import AgentResult


class FakeBale:
    def __init__(self):
        self.sent = []
        self._mid = 0
    async def send_message(self, *, chat_id, text, reply_markup=None):
        self._mid += 1
        self.sent.append({"text": text, "reply_markup": reply_markup})
        return self._mid
    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass
    async def edit_message_reply_markup(self, *, chat_id, message_id, reply_markup):
        self.sent.append({"text": None, "reply_markup": reply_markup, "edit": message_id})


class FakeAgent:
    async def handle(self, text):
        return AgentResult(text="پاسخ: " + text, suggestions=[])


def _wire(monkeypatch, bale):
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_agent_for_user",
                        lambda user_id, chat_id, session_factory: FakeAgent())


def _text(uid, t, i=1):
    return {"update_id": i, "message": {"message_id": i, "from": {"id": uid}, "chat": {"id": uid}, "text": t}}


def _cb(uid, data, i=1):
    return {"update_id": i, "callback_query": {"id": "cb", "from": {"id": uid},
            "message": {"message_id": 5, "chat": {"id": uid}}, "data": data}}


async def _do_profile(db_session, uid):
    await handle_bale_update(_text(uid, "/start", 1), session_factory=lambda: db_session)
    for i, ans in enumerate(["تهران", "آپارتمان", "2", "60-100", "پکیج", "اسپلیت", "کاهش قبض برق"], start=2):
        await handle_bale_update(_text(uid, ans, i), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_motivations_widget_shown_after_profile(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _do_profile(db_session, 910)
    from energybot.onboarding.content import MOTIVATIONS_PROMPT
    assert bale.sent[-1]["text"] == MOTIVATIONS_PROMPT
    assert bale.sent[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"].startswith("ms:motivations:")


@pytest.mark.asyncio
async def test_motivations_commit_writes_profile(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _do_profile(db_session, 911)
    await handle_bale_update(_cb(911, "ms:motivations:reduce_bill", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(911, "ms:motivations:earn_rewards", 21), session_factory=lambda: db_session)
    await handle_bale_update(_cb(911, "ms:motivations:earn_rewards", 22), session_factory=lambda: db_session)  # toggle off
    await handle_bale_update(_cb(911, "ms:motivations:__done__", 23), session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 911))).scalar_one()
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.behaviour.get("motivations") == ["reduce_bill"]
```

- [ ] **Step 7: Run tests**

Run: `pytest tests/integration/test_onboarding_motivations.py tests/integration/test_onboarding_flow.py -v`
Expected: PASS (all).

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/home.py src/energybot/profile/wizard.py src/energybot/bale_adapter/handler.py tests/integration/test_onboarding_flow.py tests/integration/test_onboarding_motivations.py
git commit -m "feat(onboarding): benefits intro + motivations multi-select phase"
```

---

### Task 6: First-bill phase

Change the motivations commit to enter the `first_bill` phase; add the برق/گاز/skip prompt and its callbacks; advance to the (temporary) home terminal after a captured bill or a skip.

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py` (motivations→first_bill, `ob:bill:` callbacks, `_send_capture` advance, first_bill text handling, `_resend_phase`)
- Modify: `tests/integration/test_onboarding_flow.py` (completion tests now skip the bill step)
- Test: `tests/integration/test_onboarding_first_bill.py`

**Interfaces:**
- Consumes: `onboarding.flow`, `onboarding.content`, `BillingService` (existing capture path).
- Produces (handler-internal): `_enter_first_bill(bale, session_factory, user_id, chat_id)`, `_maybe_advance_first_bill(bale, session_factory, user_id, chat_id)`. `_send_capture` gains a `session_factory` parameter.

- [ ] **Step 1: Add first-bill helpers**

In `handler.py`, add:

```python
async def _enter_first_bill(bale, session_factory, user_id, chat_id) -> None:
    from energybot.onboarding import flow, content
    await flow.set_step(session_factory, user_id, flow.STEP_FIRST_BILL)
    markup = {"inline_keyboard": [
        [{"text": "قبض برق ⚡", "callback_data": "ob:bill:elec"},
         {"text": "قبض گاز 🔥", "callback_data": "ob:bill:gas"}],
        [{"text": "فعلاً نه", "callback_data": "ob:bill:skip"}],
    ]}
    await bale.send_message(chat_id=chat_id, text=content.FIRST_BILL_PROMPT, reply_markup=markup)


async def _maybe_advance_first_bill(bale, session_factory, user_id, chat_id) -> None:
    from energybot.onboarding import flow
    s = session_factory()
    st = await flow.load_state(s, user_id)
    if flow.active_phase(st) == flow.PHASE_FIRST_BILL:
        # TEMPORARY terminal for Task 6; Task 7 replaces this with _enter_toolbox.
        await flow.complete(session_factory, user_id)
        await _send_home(bale, chat_id)
```

- [ ] **Step 2: Route motivations commit into first_bill**

In `_handle_multiselect`, replace the motivations `__done__` terminal (the two TEMPORARY lines from Task 5) with:

```python
        if field == "motivations":
            await profile_repo.set(user.id, "behaviour.motivations", selected, source="wizard", reason="onboarding:motivations")
            await flow.clear_draft(session_factory, user.id, field)
            await _enter_first_bill(bale, session_factory, user.id, parsed.chat_id)
        return
```

- [ ] **Step 3: Thread `session_factory` into `_send_capture` and advance after capture**

Replace `_send_capture` (current lines 52-59):

```python
async def _send_capture(bale, chat_id, res, user_id, session_factory) -> None:
    if not res.ok:
        await bale.send_message(chat_id=chat_id, text=res.error)
        return
    markup = {"inline_keyboard": [[{"text": "پرداخت 💳", "callback_data": res.pay_callback}]]}
    await bale.send_message(chat_id=chat_id, text=res.summary, reply_markup=markup)
    if res.bill_db_id:
        _spawn_suggestions(user_id, chat_id, UUID(res.bill_db_id))
    await _maybe_advance_first_bill(bale, session_factory, user_id, chat_id)
```

Update all three call sites to pass `session_factory`:
- In the `UpdatePhoto` branch: `await _send_capture(bale, parsed.chat_id, res, user.id, session_factory)`
- In `_handle_bill_document`: `await _send_capture(bale, parsed.chat_id, res, user_id, session_factory)`
- In `_process_typed_bill`: `await _send_capture(bale, chat_id, res, user_id, session_factory)`

- [ ] **Step 4: Handle `ob:bill:` callbacks and first_bill text**

In the callback branch, add before the `ms:` handler:

```python
        if parsed.data.startswith("ob:bill:"):
            from energybot.onboarding import content
            choice = parsed.data[len("ob:bill:"):]
            if choice == "skip":
                await _maybe_advance_first_bill(bale, session_factory, user.id, parsed.chat_id)
            elif choice == "elec":
                await bale.send_message(chat_id=parsed.chat_id, text=content.FIRST_BILL_ELEC_HELP)
            elif choice == "gas":
                await bale.send_message(chat_id=parsed.chat_id, text=content.FIRST_BILL_GAS_HELP)
            return
```

In the phase-aware text block, add a `first_bill` branch after the `PHASE_MOTIVATIONS` branch:

```python
        elif phase == flow.PHASE_FIRST_BILL:
            if _looks_like_bill_id(text):
                pass  # falls through to the typed-bill path below, which advances via _send_capture
            elif is_wizard_answer(text):
                await _enter_first_bill(bale, session_factory, user.id, parsed.chat_id)
                return
            # a real question falls through to the agent; phase is retained
```

In `_resend_phase`, add:

```python
    elif phase == flow.PHASE_FIRST_BILL:
        await _enter_first_bill(bale, session_factory, user_id, chat_id)
```

- [ ] **Step 5: Update completion tests to skip the bill step**

In `tests/integration/test_onboarding_flow.py`, in the three tests updated in Task 5, after `_commit_motivations(...)` add a skip of the first-bill step before the HOME assertion / `bale.sent.clear()`:

```python
    await handle_bale_update(_cb(<uid>, "ob:bill:skip", 30), session_factory=lambda: db_session)
```

(Use the matching `<uid>`: 902, 904, 905.)

- [ ] **Step 6: Write the first-bill test**

Create `tests/integration/test_onboarding_first_bill.py` (reuse the `FakeBale`/`FakeAgent`/`_wire`/`_text`/`_cb`/`_do_profile` scaffold from `test_onboarding_motivations.py`, and add a motivations-commit helper). Include the following cases:

```python
import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, OnboardingState
from energybot.onboarding import flow, content
# (copy FakeBale, FakeAgent, _wire, _text, _cb, _do_profile from test_onboarding_motivations.py)


async def _through_motivations(db_session, uid):
    await _do_profile(db_session, uid)
    await handle_bale_update(_cb(uid, "ms:motivations:reduce_bill", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ms:motivations:__done__", 21), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_first_bill_prompt_after_motivations(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_motivations(db_session, 920)
    assert bale.sent[-1]["text"] == content.FIRST_BILL_PROMPT
    kb = bale.sent[-1]["reply_markup"]["inline_keyboard"]
    assert kb[0][0]["callback_data"] == "ob:bill:elec"


@pytest.mark.asyncio
async def test_elec_button_sends_help(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_motivations(db_session, 921)
    await handle_bale_update(_cb(921, "ob:bill:elec", 30), session_factory=lambda: db_session)
    assert bale.sent[-1]["text"] == content.FIRST_BILL_ELEC_HELP


@pytest.mark.asyncio
async def test_skip_first_bill_completes_to_home(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_motivations(db_session, 922)
    await handle_bale_update(_cb(922, "ob:bill:skip", 30), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    u = (await db_session.execute(select(User).where(User.bale_user_id == 922))).scalar_one()
    st = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert st.completed_at is not None
```

Add a case that a captured bill advances the phase, using monkeypatch to stub the billing capture. Stub `build_billing_service` to return an object whose `handle_input` yields a truthy `res.ok` capture, then send a typed bill id and assert home + `completed_at`:

```python
class _FakeRes:
    ok = True
    error = None
    summary = "خلاصه قبض"
    pay_callback = "pay:abc"
    bill_db_id = None


class _FakeBillingService:
    async def handle_input(self, user_id, **kw):
        return _FakeRes()


@pytest.mark.asyncio
async def test_captured_bill_completes_to_home(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    monkeypatch.setattr("energybot.bale_adapter.handler.build_billing_service", lambda sf: _FakeBillingService())
    # Also stub the bill-id detector so the typed text routes to billing.
    monkeypatch.setattr("energybot.bale_adapter.handler._looks_like_bill_id", lambda t: True)
    await _through_motivations(db_session, 923)
    await handle_bale_update(_text(923, "1234567890", 30), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert any(s["text"] == HOME_TEXT for s in bale.sent)
```

> **Note for Task 7:** `test_skip_first_bill_completes_to_home` and `test_captured_bill_completes_to_home` assert the *temporary* home terminal. Task 7 moves the first-bill terminal to the toolbox, so Task 7 Step 5 updates these two tests (skip/capture → toolbox prompt shown, `completed_at` still `None`).

- [ ] **Step 7: Run tests**

Run: `pytest tests/integration/test_onboarding_first_bill.py tests/integration/test_onboarding_flow.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/handler.py tests/integration/test_onboarding_flow.py tests/integration/test_onboarding_first_bill.py
git commit -m "feat(onboarding): first-bill prompt phase"
```

---

### Task 7: Toolbox phase

Change the first-bill terminal to enter the `toolbox` phase; render the toolbox multi-select; commit writes `service_prefs` and completes onboarding (home); skip completes with empty prefs.

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py` (first_bill→toolbox, toolbox commit/skip, `_send_toolbox`, `_resend_phase`, toolbox text handling)
- Modify: `tests/integration/test_onboarding_flow.py` (completion tests now finish via toolbox)
- Test: `tests/integration/test_onboarding_toolbox.py`

**Interfaces:**
- Consumes: `ProfileRepository.set_service_prefs`, `onboarding.flow`, `onboarding.content`, `multiselect.build_markup`.
- Produces (handler-internal): `_enter_toolbox(bale, session_factory, user_id, chat_id)`, `_send_toolbox(bale, session_factory, user_id, chat_id, *, seed=None, allow_skip)`.

- [ ] **Step 1: Add toolbox helpers**

In `handler.py`:

```python
async def _send_toolbox(bale, session_factory, user_id, chat_id, *, seed=None, allow_skip: bool) -> None:
    from energybot.bale_adapter.multiselect import build_markup
    from energybot.onboarding import flow, content
    if seed is not None:
        await flow.seed_draft(session_factory, user_id, "toolbox", seed)
    selected = await flow.get_draft(session_factory, user_id, "toolbox")
    markup = build_markup("toolbox", content.TOOLBOX_OPTIONS, selected, allow_skip=allow_skip)
    await bale.send_message(chat_id=chat_id, text=content.TOOLBOX_PROMPT, reply_markup=markup)


async def _enter_toolbox(bale, session_factory, user_id, chat_id) -> None:
    from energybot.onboarding import flow
    await flow.set_step(session_factory, user_id, flow.STEP_TOOLBOX)
    await _send_toolbox(bale, session_factory, user_id, chat_id, seed=[], allow_skip=True)
```

- [ ] **Step 2: Route the first-bill terminal into toolbox**

In `_maybe_advance_first_bill`, replace the TEMPORARY terminal (complete + home) with:

```python
    if flow.active_phase(st) == flow.PHASE_FIRST_BILL:
        await _enter_toolbox(bale, session_factory, user_id, chat_id)
```

- [ ] **Step 3: Handle toolbox commit and skip**

In `_handle_multiselect`, replace the `__done__` and `__skip__` handling so the toolbox branch is implemented. The full updated commit/skip section:

```python
    if key == "__done__":
        selected = await flow.get_draft(session_factory, user.id, field)
        if field == "motivations":
            await profile_repo.set(user.id, "behaviour.motivations", selected, source="wizard", reason="onboarding:motivations")
            await flow.clear_draft(session_factory, user.id, field)
            await _enter_first_bill(bale, session_factory, user.id, parsed.chat_id)
        else:  # toolbox
            await profile_repo.set_service_prefs(user.id, selected, source="onboarding", reason="onboarding:toolbox")
            await flow.clear_draft(session_factory, user.id, field)
            st = await flow.load_state(session, user.id)
            if flow.active_phase(st) == flow.PHASE_TOOLBOX:
                await flow.complete(session_factory, user.id)
                await _send_home(bale, parsed.chat_id)
            else:
                await bale.send_message(chat_id=parsed.chat_id, text=content.TOOLBOX_UPDATED)
        return
    if key == "__skip__":
        if field == "toolbox":
            await flow.clear_draft(session_factory, user.id, field)
            await flow.complete(session_factory, user.id)
            await _send_home(bale, parsed.chat_id)
        return
```

- [ ] **Step 4: Toolbox text handling + resume**

In the phase-aware text block, add after the `first_bill` branch:

```python
        elif phase == flow.PHASE_TOOLBOX:
            if is_wizard_answer(text):
                await _send_toolbox(bale, session_factory, user.id, parsed.chat_id, allow_skip=True)
                return
            # a real question falls through to the agent; phase is retained
```

In `_resend_phase`, add:

```python
    elif phase == flow.PHASE_TOOLBOX:
        await _send_toolbox(bale, session_factory, user_id, chat_id, allow_skip=True)
```

- [ ] **Step 5: Update completion tests to finish via toolbox**

In `tests/integration/test_onboarding_flow.py`, in the three tests, after the `ob:bill:skip` line add a toolbox skip before the HOME assertion / `bale.sent.clear()`:

```python
    await handle_bale_update(_cb(<uid>, "ms:toolbox:__skip__", 31), session_factory=lambda: db_session)
```

(Use the matching `<uid>`: 902, 904, 905.)

Also update the two first-bill "completes_to_home" tests in `tests/integration/test_onboarding_first_bill.py`, whose terminal moved from home to the toolbox:

- `test_skip_first_bill_completes_to_home` → rename to `test_skip_first_bill_enters_toolbox`; replace the HOME/`completed_at` assertions with:

```python
    from energybot.onboarding.content import TOOLBOX_PROMPT
    assert bale.sent[-1]["text"] == TOOLBOX_PROMPT
    u = (await db_session.execute(select(User).where(User.bale_user_id == 922))).scalar_one()
    st = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert st.completed_at is None
```

- `test_captured_bill_completes_to_home` → rename to `test_captured_bill_enters_toolbox`; replace the HOME assertion with:

```python
    from energybot.onboarding.content import TOOLBOX_PROMPT
    assert bale.sent[-1]["text"] == TOOLBOX_PROMPT
```

- [ ] **Step 6: Write the toolbox test**

Create `tests/integration/test_onboarding_toolbox.py` (reuse the scaffold + a helper that walks profile→motivations→first-bill-skip):

```python
import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, Profile, OnboardingState
from energybot.onboarding import content
# (copy FakeBale, FakeAgent, _wire, _text, _cb, _do_profile)


async def _through_first_bill_skip(db_session, uid):
    await _do_profile(db_session, uid)
    await handle_bale_update(_cb(uid, "ms:motivations:__done__", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ob:bill:skip", 21), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_toolbox_shown_after_first_bill(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_first_bill_skip(db_session, 930)
    assert bale.sent[-1]["text"] == content.TOOLBOX_PROMPT
    assert bale.sent[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"].startswith("ms:toolbox:")


@pytest.mark.asyncio
async def test_toolbox_commit_persists_and_completes(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_first_bill_skip(db_session, 931)
    await handle_bale_update(_cb(931, "ms:toolbox:daily_reminder", 30), session_factory=lambda: db_session)
    await handle_bale_update(_cb(931, "ms:toolbox:weekly_summary", 31), session_factory=lambda: db_session)
    await handle_bale_update(_cb(931, "ms:toolbox:__done__", 32), session_factory=lambda: db_session)
    from energybot.bale_adapter.home import HOME_TEXT
    assert bale.sent[-1]["text"] == HOME_TEXT
    u = (await db_session.execute(select(User).where(User.bale_user_id == 931))).scalar_one()
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert set(p.service_prefs) == {"daily_reminder", "weekly_summary"}
    st = (await db_session.execute(select(OnboardingState).where(OnboardingState.user_id == u.id))).scalar_one()
    assert st.completed_at is not None


@pytest.mark.asyncio
async def test_toolbox_skip_completes_with_empty_prefs(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _through_first_bill_skip(db_session, 932)
    await handle_bale_update(_cb(932, "ms:toolbox:__skip__", 30), session_factory=lambda: db_session)
    u = (await db_session.execute(select(User).where(User.bale_user_id == 932))).scalar_one()
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.service_prefs == []
```

- [ ] **Step 7: Run tests**

Run: `pytest tests/integration/test_onboarding_toolbox.py tests/integration/test_onboarding_flow.py -v`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/handler.py tests/integration/test_onboarding_flow.py tests/integration/test_onboarding_toolbox.py
git commit -m "feat(onboarding): toolbox service-preferences phase"
```

---

### Task 8: Post-onboarding toolbox editing (menu, command, catalog, keyboard)

Let a fully-onboarded user re-open the toolbox to change their preferences, from the reply keyboard «ابزارها», the `/tools` command, or the quick-action catalog. Because `active_phase` is `None` after completion, the existing `_handle_multiselect` toolbox `__done__` branch already routes to the "updated" confirmation — this task only adds the entry points.

**Files:**
- Modify: `src/energybot/bale_adapter/actions.py` (CATALOG entry + REPLY_KB_ROUTES)
- Modify: `src/energybot/bale_adapter/home.py:15-21` (REPLY_KEYBOARD adds «ابزارها»)
- Modify: `src/energybot/bale_adapter/commands.py` (COMMANDS + BOT_COMMAND_MENU)
- Modify: `src/energybot/bale_adapter/handler.py` (`_open_toolbox_editor`, `/tools`, reply-kb + quick-action routing)
- Test: `tests/integration/test_toolbox_editing.py`

**Interfaces:**
- Consumes: `ProfileRepository.get`, `_send_toolbox`.
- Produces (handler-internal): `_open_toolbox_editor(bale, session_factory, user_id, chat_id)`.

- [ ] **Step 1: Add the editor entry helper**

In `handler.py`:

```python
async def _open_toolbox_editor(bale, session_factory, user_id, chat_id) -> None:
    repo = ProfileRepository(session_factory=session_factory)
    p = await repo.get(user_id)
    await _send_toolbox(bale, session_factory, user_id, chat_id, seed=list(p.service_prefs or []), allow_skip=False)
```

- [ ] **Step 2: Add the `/tools` command and reply-kb + catalog routing**

In `handle_bale_update` text ladder, add a `/tools` branch alongside the other commands (e.g. after `/profile`):

```python
        if text == "/tools":
            await _open_toolbox_editor(bale, session_factory, user.id, parsed.chat_id)
            return
```

In the reply-keyboard routing block, add a `toolbox` kind:

```python
            elif kind == "toolbox":
                await _open_toolbox_editor(bale, session_factory, user.id, parsed.chat_id)
```

In `_dispatch_quick_action`, add before the `else`:

```python
    elif action.kind == "toolbox":
        await _open_toolbox_editor(bale, session_factory, user.id, chat_id)
```

- [ ] **Step 3: Register the catalog entry, reply-kb label, and keyboard button**

In `src/energybot/bale_adapter/actions.py`, add to `CATALOG` (before `more_help`):

```python
    "toolbox": QuickAction("toolbox", "ابزارها", "toolbox"),
```

And add to `REPLY_KB_ROUTES`:

```python
    "ابزارها": "toolbox",
```

In `src/energybot/bale_adapter/home.py`, replace `REPLY_KEYBOARD` (lines 15-21) to add the button:

```python
REPLY_KEYBOARD = {
    "keyboard": [
        [{"text": "قبض من"}, {"text": "پروفایل"}],
        [{"text": "ابزارها"}, {"text": "نسخه وب"}],
        [{"text": "راهنما"}],
    ],
    "resize_keyboard": True,
}
```

- [ ] **Step 4: Register `/tools` in the command menu**

In `src/energybot/bale_adapter/commands.py`, add `"/tools"` to `COMMANDS` and append to `BOT_COMMAND_MENU`:

```python
    {"command": "tools", "description": "ابزارها و تنظیم سرویس‌ها"},
```

- [ ] **Step 5: Write the toolbox-editing test**

Create `tests/integration/test_toolbox_editing.py` (reuse scaffold; complete a user through onboarding first via a helper that walks all phases and commits toolbox empty):

```python
import pytest
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, Profile
from energybot.onboarding import content
# (copy FakeBale, FakeAgent, _wire, _text, _cb, _do_profile)


async def _complete_onboarding(db_session, uid):
    await _do_profile(db_session, uid)
    await handle_bale_update(_cb(uid, "ms:motivations:__done__", 20), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ob:bill:skip", 21), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ms:toolbox:daily_reminder", 22), session_factory=lambda: db_session)
    await handle_bale_update(_cb(uid, "ms:toolbox:__done__", 23), session_factory=lambda: db_session)


@pytest.mark.asyncio
async def test_tools_command_opens_editor_seeded(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _complete_onboarding(db_session, 940)
    bale.sent.clear()
    await handle_bale_update(_text(940, "/tools", 50), session_factory=lambda: db_session)
    assert bale.sent[-1]["text"] == content.TOOLBOX_PROMPT
    kb = bale.sent[-1]["reply_markup"]["inline_keyboard"]
    # daily_reminder was previously selected -> seeded as checked.
    row0 = kb[0][0]
    assert row0["callback_data"] == "ms:toolbox:daily_reminder"
    assert row0["text"].startswith("✅ ")
    # No skip button in edit mode.
    assert all("__skip__" not in b["callback_data"] for b in kb[-1])


@pytest.mark.asyncio
async def test_editing_updates_prefs_without_reonboarding(db_session, monkeypatch):
    bale = FakeBale(); _wire(monkeypatch, bale)
    await _complete_onboarding(db_session, 941)
    await handle_bale_update(_text(941, "ابزارها", 50), session_factory=lambda: db_session)
    # Turn off daily_reminder, add seasonal_tips, commit.
    await handle_bale_update(_cb(941, "ms:toolbox:daily_reminder", 51), session_factory=lambda: db_session)
    await handle_bale_update(_cb(941, "ms:toolbox:seasonal_tips", 52), session_factory=lambda: db_session)
    await handle_bale_update(_cb(941, "ms:toolbox:__done__", 53), session_factory=lambda: db_session)
    assert bale.sent[-1]["text"] == content.TOOLBOX_UPDATED
    u = (await db_session.execute(select(User).where(User.bale_user_id == 941))).scalar_one()
    p = (await db_session.execute(select(Profile).where(Profile.user_id == u.id))).scalar_one()
    assert p.service_prefs == ["seasonal_tips"]
```

- [ ] **Step 6: Run the full onboarding + toolbox suite**

Run: `pytest tests/integration/test_toolbox_editing.py tests/integration/test_onboarding_flow.py tests/integration/test_onboarding_motivations.py tests/integration/test_onboarding_first_bill.py tests/integration/test_onboarding_toolbox.py -v`
Expected: PASS (all).

- [ ] **Step 7: Run the whole suite for regressions**

Run: `pytest -q`
Expected: PASS, no regressions.

- [ ] **Step 8: Commit**

```bash
git add src/energybot/bale_adapter/actions.py src/energybot/bale_adapter/home.py src/energybot/bale_adapter/commands.py src/energybot/bale_adapter/handler.py tests/integration/test_toolbox_editing.py
git commit -m "feat(onboarding): editable toolbox via menu/command/catalog"
```

---

## Notes for the implementer

- **Session semantics:** the handler passes the *same* session object for reads (`session`) and a `session_factory` for writes, mirroring the existing code (`_has_onboarding_state(session, …)` vs `ProfileRepository(session_factory=…)`). In tests `session_factory = lambda: db_session` returns that same session; do not open a second session in tests.
- **JSONB mutation:** always reassign the attribute (`st.answers = {**st.answers, …}`, `p.service_prefs = list(keys)`) so SQLAlchemy detects the change — this is why the flow/repository helpers copy-then-assign.
- **`is_wizard_answer`** (`commands.py`) treats text shorter than 40 chars without `؟`/`?` as a button-like answer; the post-wizard phases reuse it to distinguish a stray tap/nudge from a genuine question that should reach the agent.
- **Placement order matters** in the text ladder: commands → reply-kb routes → `/bill` → **phase-aware block** → `_looks_like_bill_id` → agent. The first-bill phase relies on a typed bill id falling through to the existing typed-bill path, which then advances the phase inside `_send_capture`.
```
