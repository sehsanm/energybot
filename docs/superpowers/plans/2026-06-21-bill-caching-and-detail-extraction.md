# Bill Caching + Detail Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cache Finnotech bill inquiries permanently by bill ID and persist normalized bill detail so the AI can give consumption-aware suggestions.

**Architecture:** A new `parse_bill_details` turns Finnotech's `Info` block into a provider-agnostic dict carried on `BillDetail.details` and persisted in a new `bills.details` JSONB column. `BillingService.handle_input` short-circuits to the stored bill when one exists for `(user, bill_id)`. Rendering and the `read_bills` AI tool read the normalized fields.

**Tech Stack:** Python 3.10, SQLAlchemy async, Alembic, pytest/pytest-asyncio, httpx MockTransport.

## Global Constraints

- Persian-only user-facing copy.
- Tests run via `.venv/bin/python -m pytest`. Integration tests need the test DB: `docker compose -f docker-compose.test.yml up -d` then `DATABASE_URL="postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test" .venv/bin/python -m alembic upgrade head`.
- `Bill.amount` = current period cost (debt-free) when a period is parsed, else the top-level Finnotech `Amount`.
- The payment flow charges `details.amounts.pay_amount` (top-level `Amount`), fallback `bill.amount`.
- Numeric fields coerced from Finnotech string values; missing keys omitted, never guessed.
- Commit message trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01M3Vz4f8dmXQBi7qnQ4e3K1
  ```

---

### Task 1: Normalized detail parser

**Files:**
- Create: `src/energybot/billing/bill_details.py`
- Test: `tests/test_bill_details.py`

**Interfaces:**
- Produces: `parse_bill_details(utility_type: str, raw: dict) -> dict` — reads `raw["result"]["Info"]` and `raw["result"]["Amount"]`; returns the normalized dict (electricity) or `{"raw_info": <Info>}` passthrough for other types.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_bill_details.py
from energybot.billing.bill_details import parse_bill_details

# Trimmed real Finnotech electricity response.
RAW = {"status": "DONE", "result": {
    "Amount": "6492000", "BillId": "9706459904126", "PayId": "649250240",
    "Date": "1405/03/31", "Info": {
        "CompanyName": "توزيع نيروی برق تهران بزرگ", "CustomerName": "سيدکمال ",
        "CustomerType": "حقیقی", "TariffType": "خانگی", "Phase": "3", "Amper": "25",
        "Year": "1405", "Period": "2", "TotalDaysCount": "58",
        "PreviousReadingDate": "1405/01/22", "CurrentReadingDate": "1405/03/18",
        "NormalConsumption": "366", "PeakConsumption": "136", "LowConsumption": "173",
        "FridayConsumption": "0", "ReactiveConsumption": "0", "AverageConsumption": "349",
        "BillPayableAmount": "17272819", "PeriodAmount": "10775136",
        "PreviousDebt": "6497683", "EnergyAmount": "8219830", "TaxAmount": "573540",
        "SubscriptionAmount": "31555",
    }}}


def test_electricity_parses_consumption_and_amounts():
    d = parse_bill_details("electricity", RAW)
    assert d["tariff"] == "خانگی"
    assert d["phase"] == 3 and d["amper"] == 25
    assert d["period"] == {"year": 1405, "number": 2, "days": 58}
    assert d["reading"] == {"previous_date": "1405/01/22", "current_date": "1405/03/18"}
    assert d["due_date"] == "1405/03/31"
    assert d["consumption"]["total"] == 675  # 366+136+173+0
    assert d["consumption"]["unit"] == "kWh"
    assert d["consumption"]["peak"] == 136
    assert d["amounts"]["period"] == 10775136
    assert d["amounts"]["previous_debt"] == 6497683
    assert d["amounts"]["payable"] == 17272819
    assert d["amounts"]["pay_amount"] == 6492000


def test_missing_keys_are_omitted_not_guessed():
    raw = {"result": {"Amount": "100", "Info": {"TariffType": "خانگی"}}}
    d = parse_bill_details("electricity", raw)
    assert d["tariff"] == "خانگی"
    assert "consumption" not in d  # no readings present
    assert d["amounts"] == {"pay_amount": 100}


def test_unknown_type_passthrough():
    raw = {"result": {"Amount": "5", "Info": {"X": "1"}}}
    assert parse_bill_details("gas", raw) == {"raw_info": {"X": "1"}}
    assert parse_bill_details("water", {"result": {}}) == {}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_bill_details.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'energybot.billing.bill_details'`

- [ ] **Step 3: Write minimal implementation**

```python
# src/energybot/billing/bill_details.py
from typing import Any


def _num(v: Any):
    if v is None:
        return None
    s = str(v).replace(",", "").strip()
    if s == "":
        return None
    try:
        f = float(s)
    except ValueError:
        return None
    return int(f) if f.is_integer() else f


def _compact(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", {}, [])}


def _parse_electricity(result: dict, info: dict) -> dict:
    normal, peak = _num(info.get("NormalConsumption")), _num(info.get("PeakConsumption"))
    low, friday = _num(info.get("LowConsumption")), _num(info.get("FridayConsumption"))
    tiered = [x for x in (normal, peak, low, friday) if x is not None]
    total = sum(tiered) if tiered else None
    consumption = _compact({
        "normal": normal, "peak": peak, "low": low, "friday": friday,
        "reactive": _num(info.get("ReactiveConsumption")),
        "average": _num(info.get("AverageConsumption")),
        "total": total, "unit": "kWh" if total is not None else None,
    })
    period = _compact({
        "year": _num(info.get("Year")), "number": _num(info.get("Period")),
        "days": _num(info.get("TotalDaysCount")),
    })
    reading = _compact({
        "previous_date": info.get("PreviousReadingDate"),
        "current_date": info.get("CurrentReadingDate"),
    })
    amounts = _compact({
        "period": _num(info.get("PeriodAmount")),
        "previous_debt": _num(info.get("PreviousDebt")),
        "payable": _num(info.get("BillPayableAmount")),
        "pay_amount": _num(result.get("Amount")),
        "energy": _num(info.get("EnergyAmount")),
        "tax": _num(info.get("TaxAmount")),
        "subscription": _num(info.get("SubscriptionAmount")),
    })
    return _compact({
        "company": info.get("CompanyName"),
        "customer": (info.get("CustomerName") or "").strip() or None,
        "customer_type": info.get("CustomerType"),
        "tariff": info.get("TariffType"),
        "phase": _num(info.get("Phase")),
        "amper": _num(info.get("Amper")),
        "period": period, "reading": reading,
        "due_date": result.get("Date"),
        "consumption": consumption, "amounts": amounts,
    })


def parse_bill_details(utility_type: str, raw: dict) -> dict:
    result = raw.get("result") or {}
    info = result.get("Info") or {}
    if utility_type == "electricity":
        return _parse_electricity(result, info)
    # gas/water/unknown: passthrough until dedicated parsers exist.
    return {"raw_info": info} if info else {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_bill_details.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/bill_details.py tests/test_bill_details.py
git commit -m "feat(billing): normalized bill detail parser

<trailer>"
```

---

### Task 2: `details` column (model + migration)

**Files:**
- Modify: `src/energybot/core/models.py` (Bill model, after `raw_inquiry` at line ~279)
- Create: `alembic/versions/d4e5f6a1b2c3_bill_details.py`
- Test: `tests/integration/test_billing_schema.py`

**Interfaces:**
- Produces: `Bill.details: Mapped[dict]` (JSONB, default `{}`).

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/test_billing_schema.py` (append a new test; keep existing ones):

```python
@pytest.mark.asyncio
async def test_bills_has_details_column(db_session):
    from sqlalchemy import text
    cols = (await db_session.execute(text(
        "SELECT column_name FROM information_schema.columns WHERE table_name='bills'"
    ))).scalars().all()
    assert "details" in cols
```

- [ ] **Step 2: Run test to verify it fails**

First ensure DB is migrated to current head, then run:
Run: `.venv/bin/python -m pytest tests/integration/test_billing_schema.py::test_bills_has_details_column -v`
Expected: FAIL (column `details` absent)

- [ ] **Step 3a: Add the model column**

In `src/energybot/core/models.py`, in `class Bill`, immediately after the `raw_inquiry` line add:

```python
    details: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'"), nullable=False)
```

(`JSONB` and `text` are already imported in this module.)

- [ ] **Step 3b: Write the migration**

```python
# alembic/versions/d4e5f6a1b2c3_bill_details.py
"""bill details column

Revision ID: d4e5f6a1b2c3
Revises: c3d4e5f6a1b2
Create Date: 2026-06-21
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d4e5f6a1b2c3"
down_revision = "c3d4e5f6a1b2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "bills",
        sa.Column("details", postgresql.JSONB(astext_type=sa.Text()),
                  server_default=sa.text("'{}'"), nullable=False),
    )


def downgrade() -> None:
    op.drop_column("bills", "details")
```

- [ ] **Step 3c: Apply the migration to the test DB**

Run: `DATABASE_URL="postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test" .venv/bin/python -m alembic upgrade head`
Expected: `Running upgrade c3d4e5f6a1b2 -> d4e5f6a1b2c3, bill details column`

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/integration/test_billing_schema.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/energybot/core/models.py alembic/versions/d4e5f6a1b2c3_bill_details.py tests/integration/test_billing_schema.py
git commit -m "feat(billing): add bills.details JSONB column

<trailer>"
```

---

### Task 3: `BillDetail.details` populated in `inquire_bill`

**Files:**
- Modify: `src/energybot/billing/finnotech_client.py` (`BillDetail` dataclass ~line 10; `inquire_bill` return ~line 92)
- Test: `tests/test_finnotech_client.py`

**Interfaces:**
- Consumes: `parse_bill_details` (Task 1).
- Produces: `BillDetail.details: dict` (default `{}`), populated by `inquire_bill`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_finnotech_client.py`:

```python
@pytest.mark.asyncio
async def test_inquire_bill_populates_details():
    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "DONE", "result": {
            "Amount": "6492000", "BillId": ELEC_BILL, "PayId": "649250240",
            "Date": "1405/03/31",
            "Info": {"TariffType": "خانگی", "Period": "2", "Year": "1405",
                     "NormalConsumption": "366", "PeakConsumption": "136",
                     "LowConsumption": "173", "FridayConsumption": "0",
                     "PeriodAmount": "10775136", "PreviousDebt": "6497683"},
        }})

    c = _client(handler)
    d = await c.inquire_bill(ELEC_BILL)
    assert d.details["tariff"] == "خانگی"
    assert d.details["consumption"]["total"] == 675
    assert d.details["amounts"]["period"] == 10775136
    assert d.amount == 6492000  # top-level Amount unchanged on BillDetail
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_finnotech_client.py::test_inquire_bill_populates_details -v`
Expected: FAIL (`BillDetail` has no `details`, or AttributeError)

- [ ] **Step 3a: Add the field**

In `finnotech_client.py`, update the imports and dataclass:

```python
from dataclasses import dataclass, field
```

In `BillDetail`, add as the last field:

```python
    details: dict = field(default_factory=dict)
```

- [ ] **Step 3b: Import the parser and populate it**

Add import near the top (with the other `energybot.billing` import):

```python
from energybot.billing.bill_details import parse_bill_details
```

In `inquire_bill`, change the `return BillDetail(...)` to pass `details`:

```python
        return BillDetail(
            bill_id=str(result.get("BillId") or result.get("billId") or bill_id),
            pay_id=str(pay_id) if pay_id else None,
            amount=int(str(amount_raw).replace(",", "") or 0),
            utility_type=utype,
            term=term,
            due_date=result.get("Date") or result.get("dueDate") or result.get("paymentDeadLine"),
            raw=data,
            details=parse_bill_details(utype, data),
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_finnotech_client.py -v`
Expected: PASS (all tests in file)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/finnotech_client.py tests/test_finnotech_client.py
git commit -m "feat(billing): populate BillDetail.details from inquiry

<trailer>"
```

---

### Task 4: Repository — persist details/consumption/period-amount + cache lookup

**Files:**
- Modify: `src/energybot/billing/repository.py` (`add_bill` ~line 36; add `find_bill_by_bill_id`)
- Test: `tests/integration/test_billing_repository.py`

**Interfaces:**
- Consumes: `BillDetail.details` (Task 3), `Bill.details` column (Task 2).
- Produces:
  - `BillingRepository.add_bill` now sets `details`, `consumption` (period-total kWh), and `amount` = `details.amounts.period` when present else `detail.amount`.
  - `BillingRepository.find_bill_by_bill_id(user_id: UUID, bill_id: str) -> Bill | None` — newest stored bill for `(user, bill_id)` via the subscription join, or `None`.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/test_billing_repository.py` (reuse the file's existing imports/fixtures; add `from energybot.billing.finnotech_client import BillDetail` if absent):

```python
@pytest.mark.asyncio
async def test_add_bill_stores_details_and_period_amount(db_session):
    from energybot.billing.finnotech_client import BillDetail
    repo = BillingRepository(session_factory=lambda: db_session)
    u = await _user(db_session)  # use the file's existing user helper
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="9706459904126")
    detail = BillDetail(
        bill_id="9706459904126", pay_id="649250240", amount=6492000,
        utility_type="electricity", term="1405/2", due_date="1405/03/31", raw={},
        details={"amounts": {"period": 10775136, "pay_amount": 6492000},
                 "consumption": {"total": 675, "unit": "kWh"}},
    )
    bill = await repo.add_bill(u.id, sub.id, detail)
    assert int(bill.amount) == 10775136          # period cost, not pay_amount
    assert float(bill.consumption) == 675.0
    assert bill.details["amounts"]["pay_amount"] == 6492000


@pytest.mark.asyncio
async def test_find_bill_by_bill_id_returns_stored_or_none(db_session):
    repo = BillingRepository(session_factory=lambda: db_session)
    u = await _user(db_session)
    assert await repo.find_bill_by_bill_id(u.id, "9706459904126") is None
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="9706459904126")
    from energybot.billing.finnotech_client import BillDetail
    await repo.add_bill(u.id, sub.id, BillDetail(
        bill_id="9706459904126", pay_id=None, amount=100, utility_type="electricity",
        term=None, due_date=None, raw={}, details={}))
    found = await repo.find_bill_by_bill_id(u.id, "9706459904126")
    assert found is not None and found.utility_type == "electricity"
```

> If `test_billing_repository.py` has no `_user` helper, add one mirroring `tests/integration/test_billing_service.py`'s `_user` (create `User` + `Profile`, commit, return user).

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/integration/test_billing_repository.py -k "details_and_period_amount or find_bill_by_bill_id" -v`
Expected: FAIL (`amount` is 6492000 / `find_bill_by_bill_id` missing)

- [ ] **Step 3a: Update `add_bill`**

Replace the body of `add_bill` with:

```python
    async def add_bill(self, user_id: UUID, subscription_id: UUID, detail: BillDetail) -> Bill:
        s = self._session_factory()
        details = detail.details or {}
        amounts = details.get("amounts") or {}
        consumption = details.get("consumption") or {}
        period = amounts.get("period")
        amount = int(period) if period is not None else int(detail.amount)
        total_kwh = consumption.get("total")
        bill = Bill(
            user_id=user_id, subscription_id=subscription_id, utility_type=detail.utility_type,
            pay_id=detail.pay_id, amount=amount, term=detail.term,
            consumption=(float(total_kwh) if total_kwh is not None else None),
            due_date=_parse_due(detail.due_date), status="inquired",
            raw_inquiry=detail.raw, details=details,
        )
        s.add(bill)
        await s.commit()
        await s.refresh(bill)
        return bill
```

- [ ] **Step 3b: Add `find_bill_by_bill_id`**

Add this method to `BillingRepository` (place it next to `get_bill_by_id`):

```python
    async def find_bill_by_bill_id(self, user_id: UUID, bill_id: str) -> Bill | None:
        s = self._session_factory()
        return (await s.execute(
            select(Bill)
            .join(UtilitySubscription, UtilitySubscription.id == Bill.subscription_id)
            .where(
                UtilitySubscription.user_id == user_id,
                UtilitySubscription.bill_id == bill_id,
                UtilitySubscription.deleted_at.is_(None),
            )
            .order_by(Bill.inquired_at.desc(), Bill.id.desc())
            .limit(1)
        )).scalars().first()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/integration/test_billing_repository.py -v`
Expected: PASS (existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/repository.py tests/integration/test_billing_repository.py
git commit -m "feat(billing): persist details + period amount; add cache lookup

<trailer>"
```

---

### Task 5: Field-based rendering (period cost + debt lines)

**Files:**
- Modify: `src/energybot/billing/service.py` (`render_summary` ~line 30; add `render_bill_summary`/`render_bill`)
- Test: `tests/test_bill_render.py`

**Interfaces:**
- Produces:
  - `render_bill_summary(*, utility_type: str, amount: int, term: str | None, details: dict) -> str`
  - `render_bill(obj) -> str` — accepts a `Bill` or `BillDetail` (reads `utility_type`, `amount`, `term`, `details`).
  - `render_summary(detail)` retained, delegates to `render_bill`.

- [ ] **Step 1: Write the failing test**

```python
# tests/test_bill_render.py
from energybot.billing.service import render_bill_summary


def test_shows_period_cost_and_consumption_no_debt():
    out = render_bill_summary(
        utility_type="electricity", amount=10775136, term="1405/2",
        details={"amounts": {"period": 10775136}, "consumption": {"total": 675},
                 "due_date": "1405/03/31"})
    assert "قبض برق" in out
    assert "مبلغ این دوره" in out and "۱٬۰۷۷٬۵۱۳ تومان" in out
    assert "بدهی قبلی" not in out          # no previous_debt
    assert "مصرف دوره" in out and "۶۷۵" in out
    assert "مهلت پرداخت: 1405/03/31" in out


def test_shows_debt_lines_when_present():
    out = render_bill_summary(
        utility_type="electricity", amount=10775136, term="1405/2",
        details={"amounts": {"period": 10775136, "previous_debt": 6497683,
                             "payable": 17272819}})
    assert "بدهی قبلی" in out and "۶۴۹٬۷۶۸ تومان" in out
    assert "قابل پرداخت" in out and "۱٬۷۲۷٬۲۸۱ تومان" in out


def test_cached_bill_and_fresh_detail_render_identically():
    from energybot.billing.service import render_bill

    class _Obj:
        utility_type = "electricity"; term = "1405/2"
        details = {"amounts": {"period": 10775136}, "consumption": {"total": 675}}
    fresh = _Obj(); fresh.amount = 6492000          # BillDetail-like (pay_amount)
    cached = _Obj(); cached.amount = 10775136        # Bill-like (period stored)
    assert render_bill(fresh) == render_bill(cached)  # both derive period from details
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/test_bill_render.py -v`
Expected: FAIL (`render_bill_summary` undefined)

- [ ] **Step 3: Implement the renderer**

In `src/energybot/billing/service.py`, replace the existing `render_summary` function (lines ~30-37) with:

```python
def _to_persian_digits(s: str) -> str:
    return s.translate(str.maketrans("0123456789,", "۰۱۲۳۴۵۶۷۸۹٬"))


def _fmt_amount(rial: int) -> str:
    toman = int(rial) // 10
    return _to_persian_digits(f"{toman:,}") + " تومان"


def _fmt_kwh(v) -> str:
    n = int(v) if float(v).is_integer() else v
    return _to_persian_digits(f"{n:,}")


def render_bill_summary(*, utility_type: str, amount: int, term: str | None, details: dict) -> str:
    kind = {"electricity": "برق", "gas": "گاز", "water": "آب",
            "tel": "تلفن", "mobile": "موبایل"}.get(utility_type, "قبض")
    details = details or {}
    amounts = details.get("amounts") or {}
    period_cost = amounts.get("period")
    headline = int(period_cost) if period_cost is not None else int(amount)
    lines = [f"📄 قبض {kind}", f"مبلغ این دوره: {_fmt_amount(headline)}"]
    debt = amounts.get("previous_debt")
    if debt and int(debt) > 0:
        lines.append(f"بدهی قبلی: {_fmt_amount(int(debt))}")
        payable = amounts.get("payable")
        if payable:
            lines.append(f"قابل پرداخت: {_fmt_amount(int(payable))}")
    if term:
        lines.append(f"دوره: {term}")
    total = (details.get("consumption") or {}).get("total")
    if total is not None:
        lines.append(f"مصرف دوره: {_fmt_kwh(total)} کیلووات‌ساعت")
    due = details.get("due_date")
    if due:
        lines.append(f"مهلت پرداخت: {due}")
    return "\n".join(lines)


def render_bill(obj) -> str:
    return render_bill_summary(
        utility_type=obj.utility_type, amount=int(obj.amount),
        term=obj.term, details=getattr(obj, "details", None) or {})


def render_summary(detail: BillDetail) -> str:
    return render_bill(detail)
```

> Remove the now-unused old `_fmt_amount` if it was defined separately above; the version here replaces it. Keep a single `_fmt_amount`.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/test_bill_render.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/service.py tests/test_bill_render.py
git commit -m "feat(billing): field-based bill render with period/debt split

<trailer>"
```

---

### Task 6: Service cache short-circuit + payment uses pay_amount

**Files:**
- Modify: `src/energybot/billing/service.py` (`handle_input` ~line 59; `start_payment` ~line 78)
- Test: `tests/integration/test_billing_service.py`

**Interfaces:**
- Consumes: `repo.find_bill_by_bill_id` (Task 4), `render_bill` (Task 5).
- Produces: cache-hit path in `handle_input`; `start_payment` charges `details.amounts.pay_amount` (fallback `bill.amount`).

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/test_billing_service.py`:

```python
class _CountingFin:
    """Fake Finnotech that records how many times inquire_bill is called."""
    def __init__(self):
        self.calls = 0
    async def inquire_bill(self, bill_id):
        from energybot.billing.finnotech_client import BillDetail
        self.calls += 1
        return BillDetail(
            bill_id=bill_id, pay_id="649250240", amount=6492000,
            utility_type="electricity", term="1405/2", due_date="1405/03/31", raw={},
            details={"amounts": {"period": 10775136, "pay_amount": 6492000},
                     "consumption": {"total": 675, "unit": "kWh"}})


@pytest.mark.asyncio
async def test_second_inquiry_is_cached(db_session):
    u = await _user(db_session)
    fin = _CountingFin()
    svc = _service(db_session, fin=fin)
    first = await svc.handle_input(u.id, text=_bill_id())
    second = await svc.handle_input(u.id, text=_bill_id())
    assert fin.calls == 1                       # Finnotech hit once
    assert first.bill_db_id == second.bill_db_id
    assert first.summary == second.summary
    bills = (await db_session.execute(select(Bill).where(Bill.user_id == u.id))).scalars().all()
    assert len(bills) == 1                       # no duplicate row


@pytest.mark.asyncio
async def test_payment_charges_pay_amount(db_session):
    from uuid import UUID
    from energybot.core.models import BillPayment
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    svc = _service(db_session, fin=_CountingFin())
    res = await svc.handle_input(u.id, text=_bill_id())
    bill = await repo.get_bill_by_id(UUID(res.bill_db_id))
    assert int(bill.amount) == 10775136          # period cost stored
    await svc.start_payment(u.id, chat_id=1, bill_db_id=UUID(res.bill_db_id))
    rec = (await db_session.execute(
        select(BillPayment).where(BillPayment.user_id == u.id))).scalars().first()
    assert int(rec.amount) == 6492000            # pay_amount, not period
```

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/integration/test_billing_service.py -k "cached or pay_amount" -v`
Expected: FAIL (second call still inquires / payment charges period)

- [ ] **Step 3a: Add the cache short-circuit to `handle_input`**

In `handle_input`, after the `if bn is None:` block and before the `try: detail = ...`, insert:

```python
        cached = await self._repo.find_bill_by_bill_id(user_id, bn.bill_id)
        if cached is not None:
            return CaptureResult(
                ok=True, summary=render_bill(cached),
                pay_callback=f"pay:{cached.id}", bill_db_id=str(cached.id), error=None)
```

Then change the success `return` at the end of `handle_input` to render from the new bill:

```python
        return CaptureResult(
            ok=True, summary=render_bill(bill),
            pay_callback=f"pay:{bill.id}", bill_db_id=str(bill.id), error=None,
        )
```

- [ ] **Step 3b: Charge `pay_amount` in `start_payment`**

In `start_payment`, replace the `create_session` / `create_payment` amount with the pay-amount:

```python
        amounts = (bill.details or {}).get("amounts") or {}
        charge = int(amounts.get("pay_amount") or bill.amount)
        session = await self._pay.create_session(
            amount=charge, bill_id=sub.bill_id,
            pay_id=bill.pay_id, return_url=return_url)
        await self._repo.create_payment(
            user_id, bill_db_id=bill.id, chat_id=chat_id, provider=self._provider_name,
            amount=charge, session=session)
        return session.redirect_url
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/integration/test_billing_service.py -v`
Expected: PASS (existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/service.py tests/integration/test_billing_service.py
git commit -m "feat(billing): cache inquiries by bill id; pay the pay_amount

<trailer>"
```

---

### Task 7: Expose details to the AI via `read_bills`

**Files:**
- Modify: `src/energybot/agent/tools/read_bills.py` (item dict ~line 17)
- Test: `tests/integration/test_tool_read_bills.py`

**Interfaces:**
- Consumes: `Bill.details` (persisted, Task 4).
- Produces: each `read_bills` item gains `"details": b.details`.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/test_tool_read_bills.py` (follow the file's existing setup for seeding a bill; seed one with `details`):

```python
@pytest.mark.asyncio
async def test_read_bills_includes_details(db_session):
    from energybot.billing.repository import BillingRepository
    from energybot.billing.finnotech_client import BillDetail
    from energybot.agent.tools.read_bills import ReadBillsTool
    repo = BillingRepository(session_factory=lambda: db_session)
    u = await _user(db_session)  # file's existing helper
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="9706459904126")
    await repo.add_bill(u.id, sub.id, BillDetail(
        bill_id="9706459904126", pay_id="649250240", amount=6492000,
        utility_type="electricity", term="1405/2", due_date=None, raw={},
        details={"amounts": {"period": 10775136}, "consumption": {"total": 675}}))
    out = await ReadBillsTool(repo=repo, user_id=u.id).invoke({})
    assert out["bills"][0]["details"]["consumption"]["total"] == 675
```

> If the file lacks a `_user` helper, add one as in Task 4.

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv/bin/python -m pytest tests/integration/test_tool_read_bills.py::test_read_bills_includes_details -v`
Expected: FAIL (`KeyError: 'details'`)

- [ ] **Step 3: Add `details` to each item**

In `read_bills.py`, change the `items` comprehension to include details:

```python
        items = [{
            "utility_type": b.utility_type, "amount": int(b.amount), "term": b.term,
            "status": b.status, "inquired_at": b.inquired_at.isoformat(),
            "details": b.details,
        } for b in bills]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv/bin/python -m pytest tests/integration/test_tool_read_bills.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/energybot/agent/tools/read_bills.py tests/integration/test_tool_read_bills.py
git commit -m "feat(agent): expose bill details to read_bills tool

<trailer>"
```

---

### Task 8: Full-suite regression

**Files:** none (verification only)

- [ ] **Step 1: Run the whole suite**

Run: `.venv/bin/python -m pytest -q`
Expected: all pass except the pre-existing environmental `test_db_smoke.py::test_pg_trgm_extension_present` (only if the local test DB lacks the `pg_trgm` extension; create it with `docker exec energybot-test-db psql -U energybot -d energybot_test -c "CREATE EXTENSION IF NOT EXISTS pg_trgm;"` to make it green).

- [ ] **Step 2: Confirm no new failures** versus the baseline (240 passed, 1 skipped before this work).

---

## Notes for deployment (after all tasks merge)

- The new migration ships automatically: `bin/deploy.sh` runs `alembic upgrade head` on the prod DB before swapping the container.
- No new env vars.
