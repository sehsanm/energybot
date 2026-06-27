# Bill Suggestions + Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a user uploads a new bill, generate personalized Persian energy-saving suggestions + measurable targets via an LLM exactly once per bill, persist them, merge targets into the user's profile goals, and deliver them as a follow-up Bale message.

**Architecture:** A background task (`asyncio.create_task`, spawned from the bill-capture chokepoint `_send_capture`) runs `generate_and_send_suggestions` on its own DB session. That function loads the bill, short-circuits if suggestions already exist (re-upload → re-send stored, no LLM), otherwise renders a prompt with bill+profile+previous-bill context, calls the provider router, parses strict JSON, persists the payload to `bills.suggestions`, appends each target to `Profile.goals`, and sends the rendered message.

**Tech Stack:** Python 3.10, FastAPI, SQLAlchemy (async) + asyncpg, Postgres (JSONB), Alembic, Jinja2 prompts, pytest/pytest-asyncio.

## Global Constraints

- All user-facing copy is **Persian (fa)**. Numbers shown to users use Persian digits (helpers exist in `billing/service.py`: `_to_persian_digits`, `_fmt_amount`).
- LLM calls go through `ProviderRouter.chat(call_type=..., req=ChatRequest, prompt_key=..., prompt_version=...)`. Models are resolved from the `model_configs` table by `call_type`; pass `model=""` in `ChatRequest` (the router overwrites it).
- Prompts live in the `prompt_templates` table, rendered via `PromptLoader.render(key, variables) -> (body, key, version)` with **StrictUndefined** Jinja — reference dict fields with `.get('x', default)`, never bare attribute access on possibly-missing keys.
- Repos take `session_factory: Callable[[], AsyncSession]` and call `self._session_factory()` per method. Background work must use a **fresh** session (`get_sessionmaker()`), never the request-scoped `lambda: session`.
- Generation must be **idempotent / once-per-bill**: only generate when `bill.suggestions is None`; the NULL guard also prevents double-appending goals.
- New module: `src/energybot/billing/suggestions.py`. Tests: `tests/test_bill_suggestions.py` (pure units), `tests/integration/test_bill_suggestions.py` (DB).
- Run unit tests with: `pytest tests/test_bill_suggestions.py -v`
- Run integration tests with: `docker compose -f docker-compose.test.yml up -d` then `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v`
- Integration tests require the migration applied to the test DB: `DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test alembic upgrade head`

---

### Task 1: DB migration + `Bill.suggestions` model field

**Files:**
- Create: `alembic/versions/e5f6a1b2c3d4_bill_suggestions.py`
- Modify: `src/energybot/core/models.py:280` (add field to `Bill`)
- Test: `tests/integration/test_bill_suggestions.py`

**Interfaces:**
- Produces: `Bill.suggestions: Mapped[dict | None]` (JSONB, nullable, default NULL).

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_bill_suggestions.py`:

```python
import os
import pytest
from uuid import uuid4
from sqlalchemy import select
from energybot.core.models import User, UtilitySubscription, Bill

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)
pytestmark = pytest.mark.asyncio


async def _bill(db_session, *, suggestions=None) -> Bill:
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
             amount=1_000_000, term="1405/2", details={}, suggestions=suggestions)
    db_session.add(b)
    await db_session.commit()
    return b


async def test_bill_suggestions_column_roundtrips(db_session):
    b = await _bill(db_session, suggestions={"intro": "x", "tips": [], "targets": []})
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions == {"intro": "x", "tips": [], "targets": []}


async def test_bill_suggestions_defaults_none(db_session):
    b = await _bill(db_session)
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v`
Expected: FAIL — `TypeError: 'suggestions' is an invalid keyword argument for Bill` (field not defined yet).

- [ ] **Step 3: Add the model field**

In `src/energybot/core/models.py`, in class `Bill`, add after the `details` column (line 280):

```python
    suggestions: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
```

- [ ] **Step 4: Create the migration**

Create `alembic/versions/e5f6a1b2c3d4_bill_suggestions.py`:

```python
"""bill suggestions column

Revision ID: e5f6a1b2c3d4
Revises: d4e5f6a1b2c3
Create Date: 2026-06-27
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e5f6a1b2c3d4"
down_revision = "d4e5f6a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column("suggestions", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("bills", "suggestions")
```

- [ ] **Step 5: Apply the migration to the test DB**

Run: `DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test alembic upgrade head`
Expected: `Running upgrade d4e5f6a1b2c3 -> e5f6a1b2c3d4, bill suggestions column`

- [ ] **Step 6: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v`
Expected: PASS (2 passed)

- [ ] **Step 7: Commit**

```bash
git add alembic/versions/e5f6a1b2c3d4_bill_suggestions.py src/energybot/core/models.py tests/integration/test_bill_suggestions.py
git commit -m "feat(billing): add bills.suggestions JSONB column"
```

---

### Task 2: `_parse_suggestions_json` (pure)

**Files:**
- Create: `src/energybot/billing/suggestions.py`
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Produces: `_parse_suggestions_json(text: str | None) -> dict | None` — returns `{"intro": str, "tips": list[str], "targets": list[dict]}` or `None` when the text has no valid object / missing/typewrong required keys. Tolerates code fences and surrounding prose by taking the outermost `{ … }`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_bill_suggestions.py`:

```python
from energybot.billing.suggestions import _parse_suggestions_json


def test_parse_clean_json():
    out = _parse_suggestions_json('{"intro":"سلام","tips":["یک","دو"],"targets":[{"text":"هدف"}]}')
    assert out == {"intro": "سلام", "tips": ["یک", "دو"], "targets": [{"text": "هدف"}]}


def test_parse_code_fenced_with_prose():
    raw = "اینم خروجی:\n```json\n{\"intro\":\"x\",\"tips\":[\"a\"],\"targets\":[]}\n```\nموفق باشی"
    out = _parse_suggestions_json(raw)
    assert out == {"intro": "x", "tips": ["a"], "targets": []}


def test_parse_drops_nontext_tips_and_targets():
    out = _parse_suggestions_json('{"intro":"x","tips":["a","  "],"targets":[{"text":"ok"},{"no":1},"bad"]}')
    assert out == {"intro": "x", "tips": ["a"], "targets": [{"text": "ok"}]}


def test_parse_rejects_garbage():
    assert _parse_suggestions_json("not json at all") is None
    assert _parse_suggestions_json("") is None
    assert _parse_suggestions_json(None) is None


def test_parse_rejects_missing_required_keys():
    assert _parse_suggestions_json('{"intro":"x","tips":"notalist","targets":[]}') is None
    assert _parse_suggestions_json('{"tips":[],"targets":[]}') is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'energybot.billing.suggestions'`

- [ ] **Step 3: Write minimal implementation**

Create `src/energybot/billing/suggestions.py`:

```python
import json

from energybot.logging import get_logger

log = get_logger(__name__)


def _parse_suggestions_json(text: str | None) -> dict | None:
    if not text:
        return None
    t = text.strip()
    start, end = t.find("{"), t.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        data = json.loads(t[start:end + 1])
    except (ValueError, TypeError):
        return None
    if not isinstance(data, dict):
        return None
    intro, tips, targets = data.get("intro"), data.get("tips"), data.get("targets")
    if not isinstance(intro, str):
        return None
    if not isinstance(tips, list) or not all(isinstance(x, str) for x in tips):
        return None
    if not isinstance(targets, list):
        return None
    return {
        "intro": intro.strip(),
        "tips": [x.strip() for x in tips if x.strip()],
        "targets": [t for t in targets if isinstance(t, dict) and isinstance(t.get("text"), str)],
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bill_suggestions.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/test_bill_suggestions.py
git commit -m "feat(billing): add _parse_suggestions_json"
```

---

### Task 3: `render_suggestions` (pure)

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Consumes: a payload dict shaped like `_parse_suggestions_json` output (plus optional extra keys).
- Produces: `render_suggestions(payload: dict) -> str` — Persian follow-up message; omits empty sections.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_bill_suggestions.py`:

```python
from energybot.billing.suggestions import render_suggestions


def test_render_full():
    msg = render_suggestions({
        "intro": "مصرف بالاست",
        "tips": ["کولر را کم کن", "لامپ‌ها را عوض کن"],
        "targets": [{"text": "۱۰٪ کمتر در اوج"}, {"text": "خاموش‌کردن استندبای"}],
    })
    assert "💡 پیشنهادها برای این قبض" in msg
    assert "مصرف بالاست" in msg
    assert "• کولر را کم کن" in msg
    assert "🎯 هدف‌ها" in msg
    assert "- ۱۰٪ کمتر در اوج" in msg


def test_render_omits_empty_sections():
    msg = render_suggestions({"intro": "", "tips": [], "targets": []})
    assert msg.strip() == "💡 پیشنهادها برای این قبض"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k render`
Expected: FAIL — `ImportError: cannot import name 'render_suggestions'`

- [ ] **Step 3: Write minimal implementation**

Append to `src/energybot/billing/suggestions.py`:

```python
def render_suggestions(payload: dict) -> str:
    intro = (payload.get("intro") or "").strip()
    tips = payload.get("tips") or []
    targets = payload.get("targets") or []
    lines = ["💡 پیشنهادها برای این قبض"]
    if intro:
        lines.append(intro)
    if tips:
        lines.append("")
        lines.extend(f"• {t}" for t in tips)
    if targets:
        lines.append("")
        lines.append("🎯 هدف‌ها")
        lines.extend(f"- {t.get('text', '')}" for t in targets)
    return "\n".join(lines)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bill_suggestions.py -v -k render`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/test_bill_suggestions.py
git commit -m "feat(billing): add render_suggestions"
```

---

### Task 4: `_build_targets_as_goals` (pure)

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Produces: `_build_targets_as_goals(targets: list[dict], bill_id: str) -> list[dict]` — maps each target to a profile-goal item `{id, text, status:"active", source:"bill_suggestion", bill_id, metric, baseline, target_value, target_date}`. Missing optional fields become `None`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_bill_suggestions.py`:

```python
from energybot.billing.suggestions import _build_targets_as_goals


def test_build_targets_as_goals_maps_fields():
    goals = _build_targets_as_goals(
        [{"text": "کاهش اوج", "metric": "peak_kwh", "baseline": 120,
          "target_value": 108, "target_date": "1405/04/31"}],
        bill_id="bill-1",
    )
    assert len(goals) == 1
    g = goals[0]
    assert g["text"] == "کاهش اوج"
    assert g["status"] == "active"
    assert g["source"] == "bill_suggestion"
    assert g["bill_id"] == "bill-1"
    assert g["metric"] == "peak_kwh"
    assert g["baseline"] == 120
    assert g["target_value"] == 108
    assert g["target_date"] == "1405/04/31"
    assert isinstance(g["id"], str) and g["id"]


def test_build_targets_defaults_optionals_to_none():
    goals = _build_targets_as_goals([{"text": "فقط متن"}], bill_id="b")
    g = goals[0]
    assert g["metric"] is None and g["baseline"] is None
    assert g["target_value"] is None and g["target_date"] is None


def test_build_targets_unique_ids():
    goals = _build_targets_as_goals([{"text": "a"}, {"text": "b"}], bill_id="b")
    assert goals[0]["id"] != goals[1]["id"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k targets`
Expected: FAIL — `ImportError: cannot import name '_build_targets_as_goals'`

- [ ] **Step 3: Write minimal implementation**

Add the import at the top of `src/energybot/billing/suggestions.py` (next to `import json`):

```python
from uuid import uuid4
```

Append the function:

```python
def _build_targets_as_goals(targets: list[dict], bill_id: str) -> list[dict]:
    return [
        {
            "id": uuid4().hex,
            "text": t.get("text", ""),
            "status": "active",
            "source": "bill_suggestion",
            "bill_id": bill_id,
            "metric": t.get("metric"),
            "baseline": t.get("baseline"),
            "target_value": t.get("target_value"),
            "target_date": t.get("target_date"),
        }
        for t in targets
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bill_suggestions.py -v -k targets`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/test_bill_suggestions.py
git commit -m "feat(billing): map targets to profile goals"
```

---

### Task 5: Billing repo methods — persist suggestions + fetch prior bills

**Files:**
- Modify: `src/energybot/billing/repository.py` (add two methods to `BillingRepository`)
- Test: `tests/integration/test_bill_suggestions.py`

**Interfaces:**
- Produces:
  - `BillingRepository.set_bill_suggestions(bill_id: UUID, payload: dict) -> None`
  - `BillingRepository.prior_bills_for_subscription(subscription_id: UUID, *, before_bill_id: UUID, limit: int = 3) -> list[Bill]` — bills in the same subscription excluding `before_bill_id`, newest first.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/test_bill_suggestions.py`:

```python
from energybot.billing.repository import BillingRepository


async def _sub_with_bills(db_session, n: int):
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    bills = []
    for i in range(n):
        b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                 amount=1_000_000 + i, term=f"1405/{i}", details={})
        db_session.add(b)
        await db_session.flush()
        bills.append(b)
    await db_session.commit()
    return u, sub, bills


async def test_set_bill_suggestions_persists(db_session):
    _, _, bills = await _sub_with_bills(db_session, 1)
    repo = BillingRepository(session_factory=lambda: db_session)
    await repo.set_bill_suggestions(bills[0].id, {"intro": "x", "tips": [], "targets": []})
    row = (await db_session.execute(select(Bill).where(Bill.id == bills[0].id))).scalar_one()
    assert row.suggestions == {"intro": "x", "tips": [], "targets": []}


async def test_prior_bills_excludes_current_newest_first(db_session):
    _, sub, bills = await _sub_with_bills(db_session, 3)
    repo = BillingRepository(session_factory=lambda: db_session)
    prior = await repo.prior_bills_for_subscription(sub.id, before_bill_id=bills[-1].id, limit=5)
    ids = [b.id for b in prior]
    assert bills[-1].id not in ids
    assert len(ids) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v -k "set_bill or prior"`
Expected: FAIL — `AttributeError: 'BillingRepository' object has no attribute 'set_bill_suggestions'`

- [ ] **Step 3: Write minimal implementation**

In `src/energybot/billing/repository.py`, add to class `BillingRepository` (after `get_bill_by_id`, around line 98):

```python
    async def set_bill_suggestions(self, bill_id: UUID, payload: dict) -> None:
        s = self._session_factory()
        bill = (await s.execute(select(Bill).where(Bill.id == bill_id))).scalar_one()
        bill.suggestions = payload
        await s.commit()

    async def prior_bills_for_subscription(
        self, subscription_id: UUID, *, before_bill_id: UUID, limit: int = 3
    ) -> list["Bill"]:
        s = self._session_factory()
        return list((await s.execute(
            select(Bill)
            .where(Bill.subscription_id == subscription_id, Bill.id != before_bill_id)
            .order_by(Bill.inquired_at.desc(), Bill.id.desc())
            .limit(limit)
        )).scalars().all())
```

(`Bill`, `select`, and `UUID` are already imported in this module.)

- [ ] **Step 4: Run test to verify it passes**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v -k "set_bill or prior"`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/repository.py tests/integration/test_bill_suggestions.py
git commit -m "feat(billing): repo methods for suggestions + prior bills"
```

---

### Task 6: Seed prompt template + model config for `bill_suggestions`

**Files:**
- Create: `scripts/seed_data/prompts/bill_suggestions.md`
- Modify: `scripts/seed_dev.py` (add an entry to `DEFAULT_MODEL_CONFIGS`)
- Test: `tests/test_bill_suggestions.py`

**Interfaces:**
- Produces: an active prompt template under key `bill_suggestions` and an active `model_configs` row for `call_type="bill_suggestions"` once `scripts/seed_dev.py` runs.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_bill_suggestions.py`:

```python
import importlib.util
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[1]


def test_prompt_seed_file_present():
    p = _ROOT / "scripts" / "seed_data" / "prompts" / "bill_suggestions.md"
    text = p.read_text(encoding="utf-8")
    assert "key: bill_suggestions" in text
    # Prompt must demand strict JSON with the three keys we parse.
    assert "intro" in text and "tips" in text and "targets" in text


def test_model_config_has_bill_suggestions():
    spec = importlib.util.spec_from_file_location("seed_dev", _ROOT / "scripts" / "seed_dev.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    cfgs = {c["call_type"]: c for c in mod.DEFAULT_MODEL_CONFIGS}
    assert "bill_suggestions" in cfgs
    assert cfgs["bill_suggestions"]["params"].get("fallback")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_suggestions.py -v -k "seed or model_config"`
Expected: FAIL — `FileNotFoundError` on the prompt path / `KeyError: 'bill_suggestions'`.

- [ ] **Step 3: Create the prompt template file**

Create `scripts/seed_data/prompts/bill_suggestions.md`:

```markdown
---
key: bill_suggestions
name: تولید پیشنهاد و هدف از روی قبض
notes: ورودی‌ها شامل اطلاعات این قبض، پروفایل خانوار و قبض دوره قبل است. خروجی فقط JSON معتبر.
---
تو یک مشاور صرفه‌جویی انرژی فارسی‌زبان و دقیق هستی. بر اساس داده‌های زیر، چند پیشنهاد عملی و چند «هدف» قابل‌اندازه‌گیری برای کاربر بساز.

اطلاعات این قبض:
- نوع: {{ utility_kind }}
- مبلغ این دوره: {{ amount_toman }} تومان
- دوره: {{ term }}
- مصرف کل: {{ total_kwh }} کیلووات‌ساعت
- مصرف اوج: {{ peak_kwh }}
- مصرف عادی: {{ normal_kwh }}
- مصرف کم‌باری: {{ low_kwh }}

پروفایل خانوار:
- شهر: {{ household.get('city', 'نامشخص') }}
- نوع منزل: {{ household.get('home_type', 'نامشخص') }}
- تعداد ساکنان: {{ household.get('occupants', 'نامشخص') }}
- متراژ: {{ household.get('area_m2', 'نامشخص') }}
- گرمایش: {{ household.get('heating_type', 'نامشخص') }}
- سرمایش: {{ household.get('cooling_type', 'نامشخص') }}
- دغدغه اصلی: {{ household.get('main_concern', 'نامشخص') }}

{% if prev %}قبض دوره قبل: مبلغ {{ prev.get('amount_toman') }} تومان، مصرف کل {{ prev.get('total_kwh') }} کیلووات‌ساعت.{% else %}قبض دوره قبلی ثبت نشده است.{% endif %}

قواعد:
- خروجی را فقط و فقط به‌صورت یک شیء JSON معتبر بده. هیچ متنی بیرون از JSON ننویس.
- همه متن‌ها فارسی و کوتاه و عملی باشند و به همین خانوار و همین قبض ربط داشته باشند.
- اگر قبض دوره قبل موجود است، در `intro` به تغییر مصرف اشاره کن.
- بین ۲ تا ۴ پیشنهاد در `tips`.
- بین ۱ تا ۳ هدف در `targets`. هر هدف باید قابل‌اندازه‌گیری باشد.
- برای هر هدف: `text` (شرح فارسی)، `metric` یکی از "peak_kwh" | "total_kwh" | "amount_rial"، `baseline` (عدد فعلی یا null)، `target_value` (عدد هدف یا null)، `target_date` (تاریخ شمسی مثل "1405/04/31" یا null).

ساختار خروجی:
{"intro": "...", "tips": ["...", "..."], "targets": [{"text": "...", "metric": "peak_kwh", "baseline": 0, "target_value": 0, "target_date": "1405/04/31"}]}
```

- [ ] **Step 4: Add the model config entry**

In `scripts/seed_dev.py`, append to the `DEFAULT_MODEL_CONFIGS` list (after the `embed` entry):

```python
    {
        "call_type": "bill_suggestions",
        "provider": "deepseek",
        "model_name": "deepseek-v4-flash",
        "params": {"temperature": 0.4, "fallback": {"provider": "metis", "model_name": "gpt-4o-mini"}},
        "is_active": True,
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_bill_suggestions.py -v -k "seed or model_config"`
Expected: PASS (2 passed)

- [ ] **Step 6: Seed the dev DB (manual verification)**

Run: `python scripts/seed_dev.py`
Expected: output includes `prompt 'bill_suggestions': inserted v1` and a model_config insert for `bill_suggestions`.

- [ ] **Step 7: Commit**

```bash
git add scripts/seed_data/prompts/bill_suggestions.md scripts/seed_dev.py tests/test_bill_suggestions.py
git commit -m "feat(billing): seed bill_suggestions prompt + model config"
```

---

### Task 7: Orchestration — `generate_and_send_suggestions`

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/integration/test_bill_suggestions.py`

**Interfaces:**
- Consumes: `_parse_suggestions_json`, `render_suggestions`, `_build_targets_as_goals` (this module); `BillingRepository.get_bill_by_id/set_bill_suggestions/prior_bills_for_subscription`; `ProfileRepository.get/append`; `ProviderRouter.chat`; `PromptLoader.render`.
- Produces:
  - `_build_prompt_variables(bill, profile, prev) -> dict`
  - `async generate_and_send_suggestions(*, user_id: UUID, chat_id: int, bill_db_id: UUID, session_factory=None, router=None, prompt_loader=None, bale=None) -> None`
  - Behavior: NULL guard (re-upload re-sends stored, no LLM/no goal append); on success persists payload, appends goals (`source="bill_suggestion"`), sends rendered message; on LLM/parse error logs and leaves `suggestions` NULL.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/test_bill_suggestions.py`:

```python
import json as _json
from energybot.profile.repository import ProfileRepository
from energybot.core.models import Profile


class _FakeRouter:
    def __init__(self, content: str):
        self.content = content
        self.calls = 0

    async def chat(self, *, call_type, req, prompt_key=None, prompt_version=None):
        self.calls += 1
        from energybot.providers.base import ChatResponse
        return ChatResponse(content=self.content, tokens_in=1, tokens_out=1,
                            finish_reason="stop", model="fake-model")


class _FakeLoader:
    def __init__(self):
        self.vars = None

    async def render(self, key, variables):
        self.vars = variables
        return ("PROMPT", key, 1)


class _FakeBale:
    def __init__(self):
        self.sent = []

    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append(text)


async def _user_profile_bill(db_session):
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, household={"city": "تهران"}))
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
             amount=2_000_000, term="1405/2",
             details={"consumption": {"total": 300, "peak": 120}, "amounts": {"period": 2_000_000}})
    db_session.add(b)
    await db_session.commit()
    return u, b


_GOOD = _json.dumps({
    "intro": "مصرفت بالاست", "tips": ["کولر را کم کن"],
    "targets": [{"text": "۱۰٪ کمتر در اوج", "metric": "peak_kwh", "baseline": 120, "target_value": 108}],
}, ensure_ascii=False)


async def test_generate_persists_appends_goal_and_sends(db_session):
    from energybot.billing.suggestions import generate_and_send_suggestions
    u, b = await _user_profile_bill(db_session)
    router, loader, bale = _FakeRouter(_GOOD), _FakeLoader(), _FakeBale()
    await generate_and_send_suggestions(
        user_id=u.id, chat_id=555, bill_db_id=b.id,
        session_factory=lambda: db_session, router=router, prompt_loader=loader, bale=bale)
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions["intro"] == "مصرفت بالاست"
    assert row.suggestions["model"] == "fake-model"
    prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)
    assert any(g["source"] == "bill_suggestion" for g in prof.goals)
    assert bale.sent and "۱۰٪ کمتر در اوج" in bale.sent[0]
    # Prompt received the household context.
    assert loader.vars["household"]["city"] == "تهران"


async def test_generate_is_idempotent_on_reupload(db_session):
    from energybot.billing.suggestions import generate_and_send_suggestions
    u, b = await _user_profile_bill(db_session)
    # Pre-existing suggestions => re-upload path.
    await BillingRepository(session_factory=lambda: db_session).set_bill_suggestions(
        b.id, {"intro": "ذخیره‌شده", "tips": [], "targets": []})
    router, bale = _FakeRouter(_GOOD), _FakeBale()
    await generate_and_send_suggestions(
        user_id=u.id, chat_id=1, bill_db_id=b.id,
        session_factory=lambda: db_session, router=router, prompt_loader=_FakeLoader(), bale=bale)
    assert router.calls == 0  # no LLM call
    prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)
    assert prof.goals == []  # no goals appended
    assert "ذخیره‌شده" in bale.sent[0]


async def test_generate_parse_failure_leaves_null(db_session):
    from energybot.billing.suggestions import generate_and_send_suggestions
    u, b = await _user_profile_bill(db_session)
    router, bale = _FakeRouter("totally not json"), _FakeBale()
    await generate_and_send_suggestions(
        user_id=u.id, chat_id=1, bill_db_id=b.id,
        session_factory=lambda: db_session, router=router, prompt_loader=_FakeLoader(), bale=bale)
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions is None
    prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)
    assert prof.goals == []
    assert bale.sent == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v -k generate`
Expected: FAIL — `ImportError: cannot import name 'generate_and_send_suggestions'`

- [ ] **Step 3: Write the implementation**

Add to the imports at the top of `src/energybot/billing/suggestions.py`:

```python
from datetime import datetime
from uuid import UUID

from energybot.providers.base import ChatRequest, ChatMessage
```

Append to `src/energybot/billing/suggestions.py`:

```python
def _build_prompt_variables(bill, profile, prev) -> dict:
    details = bill.details or {}
    cons = details.get("consumption") or {}
    amounts = details.get("amounts") or {}

    def toman(rial):
        return int(rial) // 10 if rial is not None else None

    prev_block = None
    if prev is not None:
        pdet = prev.details or {}
        prev_block = {
            "amount_toman": toman((pdet.get("amounts") or {}).get("period") or prev.amount),
            "total_kwh": (pdet.get("consumption") or {}).get("total"),
            "term": prev.term,
        }
    return {
        "utility_kind": {"electricity": "برق", "gas": "گاز", "water": "آب"}.get(bill.utility_type, "قبض"),
        "amount_toman": toman(amounts.get("period") or bill.amount),
        "term": bill.term,
        "total_kwh": cons.get("total"),
        "peak_kwh": cons.get("peak"),
        "normal_kwh": cons.get("normal"),
        "low_kwh": cons.get("low"),
        "household": profile.household or {},
        "behaviour": profile.behaviour or {},
        "prev": prev_block,
    }


async def _generate(sf, *, user_id, chat_id, bill_db_id, router, prompt_loader, bale):
    from energybot.billing.repository import BillingRepository
    from energybot.profile.repository import ProfileRepository

    billing_repo = BillingRepository(session_factory=sf)
    bill = await billing_repo.get_bill_by_id(bill_db_id)
    if bill is None:
        return
    if bale is None:
        from energybot.bale_adapter.handler import get_bale_client
        bale = get_bale_client()
    if bill.suggestions is not None:
        await bale.send_message(chat_id=chat_id, text=render_suggestions(bill.suggestions))
        return

    profile_repo = ProfileRepository(session_factory=sf)
    profile = await profile_repo.get(user_id)
    prior = await billing_repo.prior_bills_for_subscription(
        bill.subscription_id, before_bill_id=bill.id, limit=1)
    prev = prior[0] if prior else None

    if router is None:
        from energybot.providers.factory import build_providers
        from energybot.providers.router import ProviderRouter
        from energybot.settings import get_settings
        router = ProviderRouter(providers=build_providers(get_settings()), session_factory=sf)
    if prompt_loader is None:
        from energybot.agent.prompts import PromptLoader
        prompt_loader = PromptLoader(session_factory=sf)

    try:
        body, key, version = await prompt_loader.render(
            "bill_suggestions", _build_prompt_variables(bill, profile, prev))
        req = ChatRequest(model="", messages=[ChatMessage(role="user", content=body)])
        resp = await router.chat(call_type="bill_suggestions", req=req,
                                 prompt_key=key, prompt_version=version)
    except Exception as e:  # noqa: BLE001 — provider/render failures are non-fatal
        log.warning("bill_suggestions_failed", error=str(e), bill_id=str(bill_db_id))
        return

    parsed = _parse_suggestions_json(resp.content)
    if parsed is None:
        log.warning("bill_suggestions_parse_failed", bill_id=str(bill_db_id))
        return

    payload = {
        "generated_at": datetime.utcnow().isoformat(),
        "intro": parsed["intro"],
        "tips": parsed["tips"],
        "targets": parsed["targets"],
        "model": resp.model,
        "prompt_version": version,
    }
    await billing_repo.set_bill_suggestions(bill.id, payload)
    for goal in _build_targets_as_goals(parsed["targets"], str(bill.id)):
        await profile_repo.append(user_id, "goals", goal,
                                  source="bill_suggestion", reason="هدف پیشنهادی از روی قبض")
    await bale.send_message(chat_id=chat_id, text=render_suggestions(payload))


async def generate_and_send_suggestions(
    *, user_id: UUID, chat_id: int, bill_db_id: UUID,
    session_factory=None, router=None, prompt_loader=None, bale=None,
) -> None:
    if session_factory is not None:
        await _generate(session_factory, user_id=user_id, chat_id=chat_id, bill_db_id=bill_db_id,
                        router=router, prompt_loader=prompt_loader, bale=bale)
        return
    from energybot.core.db import get_sessionmaker
    Session = get_sessionmaker()
    async with Session() as session:
        await _generate(lambda: session, user_id=user_id, chat_id=chat_id, bill_db_id=bill_db_id,
                        router=router, prompt_loader=prompt_loader, bale=bale)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bill_suggestions.py -v -k generate`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/integration/test_bill_suggestions.py
git commit -m "feat(billing): generate_and_send_suggestions orchestration"
```

---

### Task 8: Handler wiring — spawn the background task from `_send_capture`

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py` (`_send_capture` + its three call sites + module-level task set)
- Test: `tests/integration/test_bot_handler_billing.py`

**Interfaces:**
- Consumes: `generate_and_send_suggestions` (Task 7).
- Produces: `_send_capture(bale, chat_id, res, user_id)` — after sending the capture, if `res.ok and res.bill_db_id`, calls `_spawn_suggestions(user_id, chat_id, UUID(res.bill_db_id))`. `_spawn_suggestions` schedules the task and is monkeypatchable in tests.

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/test_bot_handler_billing.py` (reuse that file's existing fixtures/fakes for building an update; the key assertion is that a successful capture schedules suggestions). Add a focused unit-style test:

```python
import pytest
from uuid import uuid4, UUID
from energybot.bale_adapter import handler as h


@pytest.mark.asyncio
async def test_send_capture_spawns_suggestions(monkeypatch):
    calls = []
    monkeypatch.setattr(h, "_spawn_suggestions",
                        lambda user_id, chat_id, bill_db_id: calls.append((user_id, chat_id, bill_db_id)))

    class _Bale:
        async def send_message(self, *, chat_id, text, reply_markup=None):
            pass

    from energybot.billing.service import CaptureResult
    bid = uuid4()
    uid = uuid4()
    res = CaptureResult(ok=True, summary="خلاصه", pay_callback=f"pay:{bid}", bill_db_id=str(bid), error=None)
    await h._send_capture(_Bale(), 777, res, uid)
    assert calls == [(uid, 777, bid)]


@pytest.mark.asyncio
async def test_send_capture_no_spawn_on_error(monkeypatch):
    calls = []
    monkeypatch.setattr(h, "_spawn_suggestions",
                        lambda user_id, chat_id, bill_db_id: calls.append(1))

    class _Bale:
        async def send_message(self, *, chat_id, text, reply_markup=None):
            pass

    from energybot.billing.service import CaptureResult
    res = CaptureResult(ok=False, summary="", pay_callback=None, bill_db_id=None, error="خطا")
    await h._send_capture(_Bale(), 777, res, uuid4())
    assert calls == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bot_handler_billing.py -v -k send_capture`
Expected: FAIL — `TypeError: _send_capture() takes 3 positional arguments but 4 were given` (and `_spawn_suggestions` missing).

- [ ] **Step 3: Add the task plumbing and update `_send_capture`**

In `src/energybot/bale_adapter/handler.py`, add near the top (after `import` lines, by `_bale_singleton`):

```python
import asyncio
from uuid import UUID

_BACKGROUND_TASKS: set = set()


def _spawn_suggestions(user_id, chat_id: int, bill_db_id: UUID) -> None:
    from energybot.billing.suggestions import generate_and_send_suggestions
    task = asyncio.create_task(
        generate_and_send_suggestions(user_id=user_id, chat_id=chat_id, bill_db_id=bill_db_id)
    )
    _BACKGROUND_TASKS.add(task)
    task.add_done_callback(_BACKGROUND_TASKS.discard)
```

Replace `_send_capture` (lines 32-37) with:

```python
async def _send_capture(bale, chat_id, res, user_id):
    if not res.ok:
        await bale.send_message(chat_id=chat_id, text=res.error)
        return
    markup = {"inline_keyboard": [[{"text": "پرداخت 💳", "callback_data": res.pay_callback}]]}
    await bale.send_message(chat_id=chat_id, text=res.summary, reply_markup=markup)
    if res.bill_db_id:
        _spawn_suggestions(user_id, chat_id, UUID(res.bill_db_id))
```

(If `asyncio` / `UUID` are already imported in this file, don't duplicate the imports.)

- [ ] **Step 4: Update the three `_send_capture` call sites**

- Line ~154 (UpdatePhoto branch): `await _send_capture(bale, parsed.chat_id, res, user.id)`
- Line ~263 (end of `_handle_bill_document`): `await _send_capture(bale, parsed.chat_id, res, user_id)`
- Line ~286 (end of `_process_typed_bill`): `await _send_capture(bale, chat_id, res, user_id)`

- [ ] **Step 5: Run the new tests to verify they pass**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bot_handler_billing.py -v -k send_capture`
Expected: PASS (2 passed)

- [ ] **Step 6: Run the full billing handler + suggestions suites (regression)**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test pytest tests/integration/test_bot_handler_billing.py tests/integration/test_bill_suggestions.py tests/test_bill_suggestions.py -v`
Expected: PASS (all green). If any pre-existing handler test called `_send_capture` directly with 3 args, update it to pass a `user_id`.

- [ ] **Step 7: Commit**

```bash
git add src/energybot/bale_adapter/handler.py tests/integration/test_bot_handler_billing.py
git commit -m "feat(billing): spawn bill-suggestion task after capture"
```

---

## Self-Review

**Spec coverage:**
- Trigger after summary + own session → Task 8 (`_send_capture` spawn) + Task 7 (`generate_and_send_suggestions` owns its session). ✓
- Once-per-bill / idempotency (NULL guard, no double goals) → Task 7 (`test_generate_is_idempotent_on_reupload`). ✓
- Re-upload re-shows stored, no LLM → Task 7 idempotency test (`router.calls == 0`). ✓
- LLM context = bill + profile + prior bill → Task 5 (`prior_bills_for_subscription`) + Task 7 (`_build_prompt_variables`, `prev`). ✓
- Targets → trackable `Profile.goals` via `append(source="bill_suggestion")` → Task 4 + Task 7. ✓
- `bills.suggestions` JSONB, NULL = not generated → Task 1. ✓
- Stored payload shape (generated_at, intro, tips, targets, model, prompt_version) → Task 7. ✓
- Prompt template + model config (deepseek + metis fallback, temp 0.4) → Task 6. ✓
- Separate Persian follow-up message → Task 3 (`render_suggestions`) + Task 7 send. ✓
- LLM/parse failure: log, leave NULL, send nothing → Task 7 (`test_generate_parse_failure_leaves_null`). ✓
- Robust JSON parse (fences/prose) → Task 2. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `generate_and_send_suggestions` signature, repo method names (`set_bill_suggestions`, `prior_bills_for_subscription`), helper names (`_parse_suggestions_json`, `render_suggestions`, `_build_targets_as_goals`, `_build_prompt_variables`), and `_send_capture(bale, chat_id, res, user_id)` are used identically across tasks. ✓
