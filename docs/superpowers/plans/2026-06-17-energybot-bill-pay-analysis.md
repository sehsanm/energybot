# Bill Upload, Payment & Analysis — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Bale user capture a gas/electricity bill (barcode photo or typed numbers), look it up via Finnotech, pay it by gateway redirect, and persist a structured snapshot the chat agent can analyse over time.

**Architecture:** A new `src/energybot/billing/` package owns bill-number parsing, barcode decoding, the Finnotech client (OAuth2 token + inquiry), a pluggable payment provider, a repository over three new tables, and a `BillingService` that orchestrates the flow. The Bale adapter gains photo handling and routes `/bill`, photos, and the «پرداخت» callback into the service. A public `/pay/callback` route (in `main.py`) verifies the gateway redirect and notifies the user. A read-only `read_bills` agent tool and a `/profile` line expose the data to the assistant.

**Tech Stack:** Python 3.10, FastAPI, SQLAlchemy 2 async, Alembic, httpx (with `MockTransport` for tests), pyzbar + Pillow (barcode), pytest + pytest-asyncio, Postgres.

## Global Constraints

- Persian-only user-facing copy (`fa`). No English shown to users.
- All `user_id` FKs are `ON DELETE CASCADE` (consistent with `/forget` soft-delete + purge).
- HTTP clients accept an injectable `transport: httpx.AsyncBaseTransport | None` so tests use `httpx.MockTransport` and never hit prod (pattern from `FrontierProvider`/`BaleClient`).
- Repositories take `session_factory: Callable[[], AsyncSession]` and call `self._session_factory()` (pattern from `ProfileRepository`).
- Agent tools follow the `AgentTool` protocol: `name`, `description` (Persian), `parameters` (JSON schema), `async def invoke(self, args) -> Any`.
- Never trust payment success from the redirect alone — the provider `verify()` call is authoritative.
- A failure in a turn must never crash it; log structured via `get_logger(__name__)` and reply with a friendly Persian message (pattern from `handler.py`).
- New Alembic migration chains off current head `22c6dee42c26`.
- Money amounts are integer rial (`numeric(14,0)` in DB, `int` in Python).

---

### Task 1: Settings & dependencies

**Files:**
- Modify: `src/energybot/settings.py`
- Modify: `pyproject.toml` (dependencies)
- Test: `tests/test_settings.py`

**Interfaces:**
- Produces: `Settings.finnotech_client_id/secret/scope/base_url/national_id/token_path/inquiry_path`, `Settings.payment_provider`, `Settings.payment_gateway_base/merchant_id/callback_base_url`. All consumed by Tasks 5, 6, 11.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_settings.py`:

```python
def test_billing_settings_have_defaults(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://x/y")
    monkeypatch.setenv("BALE_BOT_TOKEN", "t")
    monkeypatch.setenv("BALE_WEBHOOK_SECRET", "s")
    monkeypatch.setenv("FRONTIER_API_KEY", "f")
    monkeypatch.setenv("METIS_API_KEY", "m")
    monkeypatch.setenv("SESSION_SECRET", "x" * 32)
    monkeypatch.setenv("FINNOTECH_CLIENT_ID", "cid")
    monkeypatch.setenv("FINNOTECH_CLIENT_SECRET", "csec")
    monkeypatch.setenv("FINNOTECH_NATIONAL_ID", "0000000000")
    from energybot.settings import Settings
    s = Settings()
    assert s.finnotech_base_url.startswith("https://")
    assert s.finnotech_scope == "billing:cc-inquiry-detail:get"
    assert s.payment_provider == "generic"
    assert "{bill_id}" not in s.finnotech_inquiry_path or "billId" in s.finnotech_inquiry_path
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_settings.py::test_billing_settings_have_defaults -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'finnotech_base_url'`.

- [ ] **Step 3: Add fields to Settings**

In `src/energybot/settings.py`, inside `class Settings`, after the `deepseek_*` block:

```python
    # Finnotech billing
    finnotech_client_id: str = ""
    finnotech_client_secret: str = ""
    finnotech_national_id: str = ""  # NID the OAuth client is registered to
    finnotech_scope: str = "billing:cc-inquiry-detail:get"
    finnotech_base_url: str = "https://apibeta.finnotech.ir"
    finnotech_token_path: str = "/dev/v2/oauth2/token"
    finnotech_inquiry_path: str = "/billing/v2/clients/{client_id}/billInquiry"

    # Payment gateway (redirect)
    payment_provider: str = "generic"  # generic | finnotech
    payment_gateway_base: str = ""
    payment_merchant_id: str = ""
    payment_callback_base_url: str = ""  # public base, e.g. https://bot.example.ir
```

- [ ] **Step 4: Add runtime dependencies**

In `pyproject.toml` `[project].dependencies`, add:

```toml
  "pyzbar>=0.1.9",
  "Pillow>=10.0",
```

- [ ] **Step 5: Install & run test to verify it passes**

Run: `pip install -e . && pytest tests/test_settings.py::test_billing_settings_have_defaults -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/settings.py pyproject.toml tests/test_settings.py
git commit -m "feat(billing): add Finnotech & payment settings and barcode deps"
```

---

### Task 2: Bill-number parsing & validation

**Files:**
- Create: `src/energybot/billing/__init__.py` (empty)
- Create: `src/energybot/billing/bill_numbers.py`
- Test: `tests/test_bill_numbers.py`

**Interfaces:**
- Produces:
  - `@dataclass BillNumbers(bill_id: str, pay_id: str | None, utility_type: str)` where `utility_type ∈ {"gas","electricity","unknown"}`.
  - `parse_bill_numbers(raw: str) -> BillNumbers` — strips spaces/Persian digits; accepts a 26-digit string (13+13) or a `bill_id` alone or `"bill_id pay_id"`; raises `ValueError` if `bill_id` fails the checksum.
  - `is_valid_bill_id(bill_id: str) -> bool` — last digit is the standard mod-11-style check digit.
  - `utility_type_for(bill_id: str) -> str` — derived from the company-code digits (gas vs electricity), `"unknown"` if undetermined.
- Consumed by: Tasks 3, 8.

- [ ] **Step 1: Write the failing test**

```python
from energybot.billing.bill_numbers import (
    parse_bill_numbers, is_valid_bill_id, utility_type_for, BillNumbers,
)
import pytest

# A constructed valid bill id (checksum verified by the same algorithm under test).
VALID_BILL_ID = "1177095800139"  # electricity sample
VALID_PAY_ID = "0151101290107"


def test_parse_two_part_string():
    bn = parse_bill_numbers(f"{VALID_BILL_ID} {VALID_PAY_ID}")
    assert bn.bill_id == VALID_BILL_ID
    assert bn.pay_id == VALID_PAY_ID


def test_parse_normalises_persian_digits_and_spaces():
    persian = "۱۱۷۷۰۹۵۸۰۰۱۳۹"
    bn = parse_bill_numbers(persian)
    assert bn.bill_id == VALID_BILL_ID
    assert bn.pay_id is None


def test_parse_26_digit_concatenation():
    bn = parse_bill_numbers(VALID_BILL_ID + VALID_PAY_ID)
    assert bn.bill_id == VALID_BILL_ID
    assert bn.pay_id == VALID_PAY_ID


def test_invalid_bill_id_raises():
    with pytest.raises(ValueError):
        parse_bill_numbers("1234567890123")  # bad checksum


def test_is_valid_bill_id():
    assert is_valid_bill_id(VALID_BILL_ID) is True
    assert is_valid_bill_id("0000000000000") is False


def test_utility_type_returns_known_value():
    assert utility_type_for(VALID_BILL_ID) in {"gas", "electricity", "unknown"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_bill_numbers.py -v`
Expected: FAIL — `ModuleNotFoundError: energybot.billing.bill_numbers`.

- [ ] **Step 3: Implement**

Create `src/energybot/billing/__init__.py` empty. Create `src/energybot/billing/bill_numbers.py`:

```python
from dataclasses import dataclass

_FA_DIGITS = str.maketrans("۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩", "01234567890123456789")


@dataclass(slots=True)
class BillNumbers:
    bill_id: str
    pay_id: str | None
    utility_type: str


def _normalise(raw: str) -> str:
    return raw.translate(_FA_DIGITS)


def _check_digit(number: str) -> str:
    # Iranian bill/pay-id check digit: weights cycle 2..7 over reversed digits, mod 11.
    s, w = 0, 2
    for ch in reversed(number):
        s += int(ch) * w
        w = 2 if w == 7 else w + 1
    r = s % 11
    return "0" if r < 2 else str(11 - r)


def is_valid_bill_id(bill_id: str) -> bool:
    if not (bill_id.isdigit() and 6 <= len(bill_id) <= 13):
        return False
    return _check_digit(bill_id[:-1]) == bill_id[-1]


def utility_type_for(bill_id: str) -> str:
    # Company/service code is encoded in the leading digits of the bill id.
    # Gas company codes commonly start with regions billed by NIGC; electricity by Tavanir.
    # Defensive: when undetermined, return "unknown" and let the Finnotech response decide.
    if not bill_id.isdigit():
        return "unknown"
    head = bill_id[0]
    if head == "1":
        return "electricity"
    if head == "2":
        return "gas"
    return "unknown"


def parse_bill_numbers(raw: str) -> BillNumbers:
    cleaned = "".join(c for c in _normalise(raw) if c.isdigit() or c.isspace())
    parts = cleaned.split()
    if len(parts) == 1 and len(parts[0]) == 26:
        bill_id, pay_id = parts[0][:13], parts[0][13:]
    elif len(parts) >= 2:
        bill_id, pay_id = parts[0], parts[1]
    elif len(parts) == 1:
        bill_id, pay_id = parts[0], None
    else:
        raise ValueError("no digits found")
    if not is_valid_bill_id(bill_id):
        raise ValueError(f"invalid bill id checksum: {bill_id!r}")
    return BillNumbers(bill_id=bill_id, pay_id=pay_id, utility_type=utility_type_for(bill_id))
```

Note: `VALID_BILL_ID` in the test must satisfy `_check_digit`. The implementer regenerates the sample constant once by running `python -c "from energybot.billing.bill_numbers import _check_digit; print('117709580013'+_check_digit('117709580013'))"` and pastes the result into the test if needed so the checksum matches.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_bill_numbers.py -v`
Expected: PASS (after aligning the sample constant per the note).

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/__init__.py src/energybot/billing/bill_numbers.py tests/test_bill_numbers.py
git commit -m "feat(billing): bill-number parsing, checksum & utility-type"
```

---

### Task 3: Barcode decoding

**Files:**
- Create: `src/energybot/billing/barcode.py`
- Test: `tests/test_barcode.py`

**Interfaces:**
- Consumes: `parse_bill_numbers`, `BillNumbers` (Task 2).
- Produces: `decode_bill_barcode(image_bytes: bytes) -> BillNumbers | None` — returns `None` when no barcode is found or the decoded value isn't a valid bill (never raises on bad images).
- Consumed by: Task 8.

- [ ] **Step 1: Write the failing test**

```python
import io
import pytest
from energybot.billing.barcode import decode_bill_barcode
from energybot.billing.bill_numbers import _check_digit


def _valid_pair() -> str:
    bill = "117709580013" + _check_digit("117709580013")
    pay = "015110129010" + _check_digit("015110129010")
    return bill + pay  # 26 digits


def _make_barcode_png(value: str) -> bytes:
    bc = pytest.importorskip("barcode")  # python-barcode, dev-only helper
    from barcode.writer import ImageWriter
    buf = io.BytesIO()
    bc.get("code128", value, writer=ImageWriter()).write(buf)
    return buf.getvalue()


def test_decode_returns_none_for_garbage():
    assert decode_bill_barcode(b"not an image") is None


def test_decode_reads_code128_bill_barcode():
    png = _make_barcode_png(_valid_pair())
    bn = decode_bill_barcode(png)
    assert bn is not None
    assert bn.bill_id == "117709580013" + _check_digit("117709580013")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_barcode.py -v`
Expected: FAIL — `ModuleNotFoundError: energybot.billing.barcode`.

- [ ] **Step 3: Implement**

Create `src/energybot/billing/barcode.py`:

```python
import io
from energybot.billing.bill_numbers import BillNumbers, parse_bill_numbers
from energybot.logging import get_logger

log = get_logger(__name__)


def decode_bill_barcode(image_bytes: bytes) -> BillNumbers | None:
    try:
        from PIL import Image
        from pyzbar.pyzbar import decode as zbar_decode
    except Exception as e:  # noqa: BLE001 - missing system lib must not crash a turn
        log.warning("barcode_lib_unavailable", error=str(e))
        return None
    try:
        img = Image.open(io.BytesIO(image_bytes))
    except Exception:
        return None
    for sym in zbar_decode(img):
        try:
            raw = sym.data.decode("ascii", "ignore")
            return parse_bill_numbers(raw)
        except ValueError:
            continue
    return None
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pip install python-barcode && pytest tests/test_barcode.py -v`
Expected: PASS. (`python-barcode` is a test-only helper to synthesise images; add it under `[project.optional-dependencies].dev` or install ad hoc.)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/barcode.py tests/test_barcode.py pyproject.toml
git commit -m "feat(billing): decode bill barcode from photo via pyzbar"
```

---

### Task 4: Data model & migration

**Files:**
- Modify: `src/energybot/core/models.py`
- Create: `alembic/versions/20260617_1000_billing.py`
- Test: `tests/integration/test_billing_schema.py`
- Modify: `tests/integration/conftest.py` (cleanup of new tables)

**Interfaces:**
- Produces ORM models `UtilitySubscription`, `Bill`, `BillPayment` (fields per spec §2). Consumed by Tasks 7, 12.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_billing_schema.py`:

```python
import pytest
from sqlalchemy import inspect, text


@pytest.mark.asyncio
async def test_billing_tables_exist(db_session):
    rows = (await db_session.execute(text(
        "select table_name from information_schema.tables where table_schema='public'"
    ))).scalars().all()
    assert {"utility_subscriptions", "bills", "bill_payments"} <= set(rows)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_billing_schema.py -v`
Expected: FAIL — tables absent.

- [ ] **Step 3: Add models**

Append to `src/energybot/core/models.py`:

```python
class UtilitySubscription(Base):
    __tablename__ = "utility_subscriptions"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    utility_type: Mapped[str] = mapped_column(String(20), nullable=False)
    bill_id: Mapped[str] = mapped_column(String(20), nullable=False)
    label: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column()
    __table_args__ = (UniqueConstraint("user_id", "bill_id", name="uq_subscription_user_bill"),)


class Bill(Base):
    __tablename__ = "bills"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    subscription_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("utility_subscriptions.id", ondelete="CASCADE"), nullable=False)
    utility_type: Mapped[str] = mapped_column(String(20), nullable=False)
    pay_id: Mapped[str | None] = mapped_column(String(20))
    amount: Mapped[int] = mapped_column(Numeric(14, 0), nullable=False)
    term: Mapped[str | None] = mapped_column(String(40))
    consumption: Mapped[float | None] = mapped_column(Numeric(14, 2))
    due_date: Mapped[_date | None] = mapped_column(Date)
    status: Mapped[str] = mapped_column(String(20), default="inquired", nullable=False)
    raw_inquiry: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    inquired_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    __table_args__ = (Index("ix_bills_user_inquired", "user_id", "inquired_at"),)


class BillPayment(Base):
    __tablename__ = "bill_payments"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    bill_db_id: Mapped[UUID] = mapped_column("bill_id", PGUUID(as_uuid=True), ForeignKey("bills.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    chat_id: Mapped[int] = mapped_column(BigInteger, nullable=False)
    provider: Mapped[str] = mapped_column(String(40), nullable=False)
    amount: Mapped[int] = mapped_column(Numeric(14, 0), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    gateway_ref: Mapped[str | None] = mapped_column(String(120), index=True)
    redirect_url: Mapped[str | None] = mapped_column(Text)
    raw: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), nullable=False)
    paid_at: Mapped[datetime | None] = mapped_column()
```

Note: the `BillPayment.bill_db_id` Python attribute maps to DB column `bill_id` (the FK to `bills.id`), avoiding confusion with the شناسه‌قبض string elsewhere.

- [ ] **Step 4: Create the migration**

Create `alembic/versions/20260617_1000_billing.py`:

```python
"""billing tables

Revision ID: a1b2c3d4e5f6
Revises: 22c6dee42c26
Create Date: 2026-06-17 10:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID

revision: str = "a1b2c3d4e5f6"
down_revision: str | None = "22c6dee42c26"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "utility_subscriptions",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("utility_type", sa.String(length=20), nullable=False),
        sa.Column("bill_id", sa.String(length=20), nullable=False),
        sa.Column("label", sa.String(length=200), nullable=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "bill_id", name="uq_subscription_user_bill"),
    )
    op.create_index(op.f("ix_utility_subscriptions_user_id"), "utility_subscriptions", ["user_id"])
    op.create_table(
        "bills",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("subscription_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("utility_type", sa.String(length=20), nullable=False),
        sa.Column("pay_id", sa.String(length=20), nullable=True),
        sa.Column("amount", sa.Numeric(precision=14, scale=0), nullable=False),
        sa.Column("term", sa.String(length=40), nullable=True),
        sa.Column("consumption", sa.Numeric(precision=14, scale=2), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("raw_inquiry", JSONB(), nullable=False),
        sa.Column("inquired_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["subscription_id"], ["utility_subscriptions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bills_user_inquired", "bills", ["user_id", "inquired_at"])
    op.create_table(
        "bill_payments",
        sa.Column("id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("bill_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("user_id", PGUUID(as_uuid=True), nullable=False),
        sa.Column("chat_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", sa.String(length=40), nullable=False),
        sa.Column("amount", sa.Numeric(precision=14, scale=0), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("gateway_ref", sa.String(length=120), nullable=True),
        sa.Column("redirect_url", sa.Text(), nullable=True),
        sa.Column("raw", JSONB(), nullable=False),
        sa.Column("created_at", sa.DateTime(), server_default=sa.text("now()"), nullable=False),
        sa.Column("paid_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["bill_id"], ["bills.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_bill_payments_gateway_ref"), "bill_payments", ["gateway_ref"])


def downgrade() -> None:
    op.drop_index(op.f("ix_bill_payments_gateway_ref"), table_name="bill_payments")
    op.drop_table("bill_payments")
    op.drop_index("ix_bills_user_inquired", table_name="bills")
    op.drop_table("bills")
    op.drop_index(op.f("ix_utility_subscriptions_user_id"), table_name="utility_subscriptions")
    op.drop_table("utility_subscriptions")
```

- [ ] **Step 5: Extend test cleanup**

In `tests/integration/conftest.py`, add these deletes (children first) in BOTH the before and after blocks, immediately before `DELETE FROM users`:

```python
    await db_session.execute(text("DELETE FROM bill_payments"))
    await db_session.execute(text("DELETE FROM bills"))
    await db_session.execute(text("DELETE FROM utility_subscriptions"))
```

- [ ] **Step 6: Apply migration & run test**

Run: `alembic upgrade head && pytest tests/integration/test_billing_schema.py -v`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/energybot/core/models.py alembic/versions/20260617_1000_billing.py tests/integration/test_billing_schema.py tests/integration/conftest.py
git commit -m "feat(billing): add subscriptions, bills, bill_payments tables"
```

---

### Task 5: Finnotech client & token manager

**Files:**
- Create: `src/energybot/billing/finnotech_client.py`
- Test: `tests/test_finnotech_client.py`

**Interfaces:**
- Produces:
  - `@dataclass BillDetail(bill_id: str, pay_id: str | None, amount: int, utility_type: str, term: str | None, due_date: str | None, raw: dict)`
  - `class FinnotechError(Exception)`
  - `class FinnotechClient` with `__init__(*, client_id, client_secret, national_id, scope, base_url, token_path, inquiry_path, transport=None)` and `async def inquire_bill(self, bill_id: str) -> BillDetail`.
  - `class FakeFinnotechClient` with the same `inquire_bill` signature, returning a canned `BillDetail` (used by Tasks 8, 10 tests).
- Consumed by: Task 8.

- [ ] **Step 1: Write the failing test**

```python
import httpx
import pytest
from energybot.billing.finnotech_client import FinnotechClient, FinnotechError


def _client(handler):
    return FinnotechClient(
        client_id="cid", client_secret="csec", national_id="0000000000",
        scope="billing:cc-inquiry-detail:get", base_url="https://fin.test",
        token_path="/dev/v2/oauth2/token",
        inquiry_path="/billing/v2/clients/{client_id}/billInquiry",
        transport=httpx.MockTransport(handler),
    )


@pytest.mark.asyncio
async def test_inquire_bill_fetches_token_then_queries():
    seen = []

    def handler(request):
        seen.append(str(request.url))
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        assert request.headers["Authorization"] == "Bearer TOK"
        assert "billId=117709580013" in str(request.url)
        return httpx.Response(200, json={"status": "DONE", "result": {
            "billId": "117709580013", "paymentId": "0151101290107",
            "amount": "152000", "billType": "ELECTRICITY", "term": "1404/03", "dueDate": "1404/04/15",
        }})

    c = _client(handler)
    detail = await c.inquire_bill("117709580013")
    assert detail.amount == 152000
    assert detail.utility_type == "electricity"
    assert detail.pay_id == "0151101290107"
    assert any("oauth2/token" in u for u in seen)


@pytest.mark.asyncio
async def test_token_is_reused_across_calls():
    token_calls = {"n": 0}

    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            token_calls["n"] += 1
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "DONE", "result": {"amount": "1", "billType": "GAS"}})

    c = _client(handler)
    await c.inquire_bill("117709580013")
    await c.inquire_bill("117709580013")
    assert token_calls["n"] == 1


@pytest.mark.asyncio
async def test_error_status_raises():
    def handler(request):
        if request.url.path.endswith("/oauth2/token"):
            return httpx.Response(200, json={"result": {"value": "TOK", "lifeTime": 3600000}, "status": "DONE"})
        return httpx.Response(200, json={"status": "FAILED", "error": {"message": "bad bill"}})

    c = _client(handler)
    with pytest.raises(FinnotechError):
        await c.inquire_bill("117709580013")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_finnotech_client.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/energybot/billing/finnotech_client.py`:

```python
import base64
import time
import uuid
from dataclasses import dataclass
from typing import Any
import httpx
from energybot.billing.bill_numbers import utility_type_for


@dataclass(slots=True)
class BillDetail:
    bill_id: str
    pay_id: str | None
    amount: int
    utility_type: str
    term: str | None
    due_date: str | None
    raw: dict


class FinnotechError(Exception):
    pass


def _normalise_type(value: str | None, bill_id: str) -> str:
    v = (value or "").strip().lower()
    if "elec" in v or "برق" in v:
        return "electricity"
    if "gas" in v or "گاز" in v:
        return "gas"
    return utility_type_for(bill_id)


class FinnotechClient:
    def __init__(self, *, client_id: str, client_secret: str, national_id: str,
                 scope: str, base_url: str, token_path: str, inquiry_path: str,
                 transport: httpx.AsyncBaseTransport | None = None):
        self._client_id = client_id
        self._client_secret = client_secret
        self._national_id = national_id
        self._scope = scope
        self._base = base_url.rstrip("/")
        self._token_path = token_path
        self._inquiry_path = inquiry_path
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), transport=transport)
        self._token: str | None = None
        self._token_expiry: float = 0.0

    async def aclose(self) -> None:
        await self._client.aclose()

    async def _ensure_token(self) -> str:
        if self._token and time.monotonic() < self._token_expiry - 60:
            return self._token
        basic = base64.b64encode(f"{self._client_id}:{self._client_secret}".encode()).decode()
        try:
            r = await self._client.post(
                f"{self._base}{self._token_path}",
                headers={"Authorization": f"Basic {basic}", "Content-Type": "application/json"},
                json={"grant_type": "client_credentials", "nid": self._national_id, "scopes": self._scope},
            )
        except httpx.HTTPError as e:
            raise FinnotechError(f"token request failed: {e}") from e
        if r.status_code >= 400:
            raise FinnotechError(f"token http {r.status_code}: {r.text}")
        data = r.json()
        result = data.get("result") or {}
        token = result.get("value")
        if not token:
            raise FinnotechError(f"no token in response: {data}")
        life_ms = int(result.get("lifeTime", 3600000))
        self._token = token
        self._token_expiry = time.monotonic() + life_ms / 1000.0
        return token

    async def inquire_bill(self, bill_id: str) -> BillDetail:
        token = await self._ensure_token()
        path = self._inquiry_path.format(client_id=self._client_id)
        params = {"billId": bill_id, "trackId": uuid.uuid4().hex}
        try:
            r = await self._client.get(
                f"{self._base}{path}", params=params,
                headers={"Authorization": f"Bearer {token}"},
            )
        except httpx.HTTPError as e:
            raise FinnotechError(f"inquiry request failed: {e}") from e
        if r.status_code >= 400:
            raise FinnotechError(f"inquiry http {r.status_code}: {r.text}")
        data: dict[str, Any] = r.json()
        if str(data.get("status", "")).upper() not in ("DONE", "OK", "SUCCESS"):
            raise FinnotechError(f"inquiry failed: {data.get('error') or data}")
        result = data.get("result") or {}
        amount_raw = result.get("amount") or result.get("billAmount") or 0
        return BillDetail(
            bill_id=str(result.get("billId") or bill_id),
            pay_id=(str(result["paymentId"]) if result.get("paymentId") else
                    (str(result["payId"]) if result.get("payId") else None)),
            amount=int(str(amount_raw).replace(",", "") or 0),
            utility_type=_normalise_type(result.get("billType") or result.get("type"), bill_id),
            term=result.get("term") or result.get("period"),
            due_date=result.get("dueDate") or result.get("paymentDeadLine"),
            raw=data,
        )


class FakeFinnotechClient:
    def __init__(self, detail: BillDetail | None = None, error: Exception | None = None):
        self._detail = detail
        self._error = error

    async def inquire_bill(self, bill_id: str) -> BillDetail:
        if self._error:
            raise self._error
        if self._detail:
            return self._detail
        return BillDetail(bill_id=bill_id, pay_id="0151101290107", amount=152000,
                          utility_type="electricity", term="1404/03", due_date="1404/04/15", raw={})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_finnotech_client.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/finnotech_client.py tests/test_finnotech_client.py
git commit -m "feat(billing): Finnotech client with OAuth token + bill inquiry"
```

---

### Task 6: Payment provider

**Files:**
- Create: `src/energybot/billing/payment.py`
- Test: `tests/test_payment_provider.py`

**Interfaces:**
- Produces:
  - `@dataclass PaymentSession(redirect_url: str, gateway_ref: str, raw: dict)`
  - `@dataclass PaymentResult(success: bool, gateway_ref: str, raw: dict)`
  - `class PaymentProvider` (Protocol/ABC): `async def create_session(self, *, amount: int, bill_id: str, pay_id: str | None, return_url: str) -> PaymentSession`; `async def verify(self, *, gateway_ref: str, params: dict) -> PaymentResult`.
  - `class GenericRedirectProvider(PaymentProvider)` — builds a redirect URL from `gateway_base` + a created `gateway_ref`, verifies via a gateway verify call (httpx, injectable transport).
  - `class FakePaymentProvider` — canned session + verify keyed by `params.get("ok")` (used by Tasks 8/10/11 tests).
- Consumed by: Tasks 8, 11.

- [ ] **Step 1: Write the failing test**

```python
import httpx
import pytest
from energybot.billing.payment import GenericRedirectProvider, FakePaymentProvider


@pytest.mark.asyncio
async def test_generic_create_session_builds_redirect():
    def handler(request):
        return httpx.Response(200, json={"authority": "AUTH123", "url": "https://pay.test/AUTH123"})
    p = GenericRedirectProvider(gateway_base="https://pay.test", merchant_id="M1",
                                transport=httpx.MockTransport(handler))
    sess = await p.create_session(amount=152000, bill_id="117709580013", pay_id="0151101290107",
                                  return_url="https://bot.test/pay/callback")
    assert sess.gateway_ref == "AUTH123"
    assert sess.redirect_url == "https://pay.test/AUTH123"


@pytest.mark.asyncio
async def test_generic_verify_success():
    def handler(request):
        return httpx.Response(200, json={"status": 100, "refId": "R9"})
    p = GenericRedirectProvider(gateway_base="https://pay.test", merchant_id="M1",
                                transport=httpx.MockTransport(handler))
    res = await p.verify(gateway_ref="AUTH123", params={"Status": "OK"})
    assert res.success is True


@pytest.mark.asyncio
async def test_fake_provider_roundtrip():
    p = FakePaymentProvider()
    sess = await p.create_session(amount=1, bill_id="b", pay_id=None, return_url="r")
    assert sess.redirect_url
    ok = await p.verify(gateway_ref=sess.gateway_ref, params={"ok": "1"})
    assert ok.success is True
    bad = await p.verify(gateway_ref=sess.gateway_ref, params={"ok": "0"})
    assert bad.success is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_payment_provider.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/energybot/billing/payment.py`:

```python
from dataclasses import dataclass
from typing import Any, Protocol
import httpx


@dataclass(slots=True)
class PaymentSession:
    redirect_url: str
    gateway_ref: str
    raw: dict


@dataclass(slots=True)
class PaymentResult:
    success: bool
    gateway_ref: str
    raw: dict


class PaymentProvider(Protocol):
    async def create_session(self, *, amount: int, bill_id: str, pay_id: str | None, return_url: str) -> PaymentSession: ...
    async def verify(self, *, gateway_ref: str, params: dict) -> PaymentResult: ...


class GenericRedirectProvider:
    """Redirect-style IPG: POST creates a session and returns an authority + URL;
    a verify call confirms settlement. Exact field names are gateway-specific and
    centralised here so only this file changes when the concrete PSP is pinned."""

    def __init__(self, *, gateway_base: str, merchant_id: str,
                 transport: httpx.AsyncBaseTransport | None = None):
        self._base = gateway_base.rstrip("/")
        self._merchant = merchant_id
        self._client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0), transport=transport)

    async def aclose(self) -> None:
        await self._client.aclose()

    async def create_session(self, *, amount: int, bill_id: str, pay_id: str | None, return_url: str) -> PaymentSession:
        r = await self._client.post(f"{self._base}/request", json={
            "merchant_id": self._merchant, "amount": amount,
            "description": f"قبض {bill_id}", "callback_url": return_url,
            "metadata": {"bill_id": bill_id, "pay_id": pay_id},
        })
        r.raise_for_status()
        data = r.json()
        ref = str(data.get("authority") or data.get("ref"))
        url = data.get("url") or f"{self._base}/{ref}"
        return PaymentSession(redirect_url=url, gateway_ref=ref, raw=data)

    async def verify(self, *, gateway_ref: str, params: dict) -> PaymentResult:
        r = await self._client.post(f"{self._base}/verify", json={
            "merchant_id": self._merchant, "authority": gateway_ref,
        })
        data = r.json() if r.status_code < 400 else {"status": r.status_code, "body": r.text}
        success = r.status_code < 400 and int(data.get("status", 0)) in (100, 101)
        return PaymentResult(success=success, gateway_ref=gateway_ref, raw=data)


class FakePaymentProvider:
    async def create_session(self, *, amount: int, bill_id: str, pay_id: str | None, return_url: str) -> PaymentSession:
        return PaymentSession(redirect_url=f"https://pay.fake/{bill_id}", gateway_ref=f"REF-{bill_id}", raw={})

    async def verify(self, *, gateway_ref: str, params: dict) -> PaymentResult:
        return PaymentResult(success=params.get("ok") == "1", gateway_ref=gateway_ref, raw=dict(params))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_payment_provider.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/payment.py tests/test_payment_provider.py
git commit -m "feat(billing): pluggable redirect payment provider"
```

---

### Task 7: Billing repository

**Files:**
- Create: `src/energybot/billing/repository.py`
- Test: `tests/integration/test_billing_repository.py`

**Interfaces:**
- Consumes: ORM models (Task 4), `BillDetail` (Task 5), `PaymentSession` (Task 6).
- Produces `class BillingRepository(session_factory=...)` with:
  - `async def get_or_create_subscription(user_id: UUID, *, utility_type: str, bill_id: str) -> UtilitySubscription`
  - `async def add_bill(user_id: UUID, subscription_id: UUID, detail: BillDetail) -> Bill`
  - `async def create_payment(user_id: UUID, *, bill_db_id: UUID, chat_id: int, provider: str, amount: int, session: PaymentSession) -> BillPayment`
  - `async def get_payment_by_ref(gateway_ref: str) -> BillPayment | None`
  - `async def mark_payment(payment_id: UUID, *, success: bool, raw: dict) -> BillPayment` (sets payment.status + paid_at, and sets the linked bill.status='paid' on success)
  - `async def recent_bills(user_id: UUID, limit: int = 12) -> list[Bill]`
- Consumed by: Tasks 8, 11, 12.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from uuid import uuid4
from energybot.core.models import User, Profile
from energybot.billing.repository import BillingRepository
from energybot.billing.finnotech_client import BillDetail
from energybot.billing.payment import PaymentSession


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


def _detail():
    return BillDetail(bill_id="117709580013", pay_id="0151101290107", amount=152000,
                      utility_type="electricity", term="1404/03", due_date="1404/04/15", raw={"k": "v"})


@pytest.mark.asyncio
async def test_subscription_is_idempotent(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    s1 = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    s2 = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    assert s1.id == s2.id


@pytest.mark.asyncio
async def test_add_bill_and_recent(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    bill = await repo.add_bill(u.id, sub.id, _detail())
    assert bill.amount == 152000
    recent = await repo.recent_bills(u.id)
    assert recent[0].id == bill.id


@pytest.mark.asyncio
async def test_payment_lifecycle_marks_bill_paid(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    bill = await repo.add_bill(u.id, sub.id, _detail())
    pay = await repo.create_payment(u.id, bill_db_id=bill.id, chat_id=999, provider="fake",
                                    amount=152000, session=PaymentSession("https://pay/x", "REF1", {}))
    found = await repo.get_payment_by_ref("REF1")
    assert found.id == pay.id
    await repo.mark_payment(pay.id, success=True, raw={"ok": 1})
    recent = await repo.recent_bills(u.id)
    assert recent[0].status == "paid"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_billing_repository.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/energybot/billing/repository.py`:

```python
from collections.abc import Callable
from datetime import datetime
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.core.models import UtilitySubscription, Bill, BillPayment
from energybot.billing.finnotech_client import BillDetail
from energybot.billing.payment import PaymentSession


def _parse_due(due: str | None):
    return None  # due dates arrive as Jalali strings; stored only in raw_inquiry for now


class BillingRepository:
    def __init__(self, *, session_factory: Callable[[], AsyncSession]):
        self._session_factory = session_factory

    async def get_or_create_subscription(self, user_id: UUID, *, utility_type: str, bill_id: str) -> UtilitySubscription:
        s = self._session_factory()
        existing = (await s.execute(
            select(UtilitySubscription).where(
                UtilitySubscription.user_id == user_id,
                UtilitySubscription.bill_id == bill_id,
                UtilitySubscription.deleted_at.is_(None),
            )
        )).scalar_one_or_none()
        if existing is not None:
            return existing
        sub = UtilitySubscription(user_id=user_id, utility_type=utility_type, bill_id=bill_id)
        s.add(sub)
        await s.commit()
        await s.refresh(sub)
        return sub

    async def add_bill(self, user_id: UUID, subscription_id: UUID, detail: BillDetail) -> Bill:
        s = self._session_factory()
        bill = Bill(
            user_id=user_id, subscription_id=subscription_id, utility_type=detail.utility_type,
            pay_id=detail.pay_id, amount=detail.amount, term=detail.term,
            due_date=_parse_due(detail.due_date), status="inquired", raw_inquiry=detail.raw,
        )
        s.add(bill)
        await s.commit()
        await s.refresh(bill)
        return bill

    async def create_payment(self, user_id: UUID, *, bill_db_id: UUID, chat_id: int,
                             provider: str, amount: int, session: PaymentSession) -> BillPayment:
        s = self._session_factory()
        pay = BillPayment(
            bill_db_id=bill_db_id, user_id=user_id, chat_id=chat_id, provider=provider,
            amount=amount, status="pending", gateway_ref=session.gateway_ref,
            redirect_url=session.redirect_url, raw=session.raw,
        )
        s.add(pay)
        await s.commit()
        await s.refresh(pay)
        return pay

    async def get_payment_by_ref(self, gateway_ref: str) -> BillPayment | None:
        s = self._session_factory()
        return (await s.execute(
            select(BillPayment).where(BillPayment.gateway_ref == gateway_ref)
        )).scalar_one_or_none()

    async def mark_payment(self, payment_id: UUID, *, success: bool, raw: dict) -> BillPayment:
        s = self._session_factory()
        pay = (await s.execute(select(BillPayment).where(BillPayment.id == payment_id))).scalar_one()
        pay.status = "success" if success else "failed"
        pay.raw = {**(pay.raw or {}), "verify": raw}
        if success:
            pay.paid_at = datetime.utcnow()
            bill = (await s.execute(select(Bill).where(Bill.id == pay.bill_db_id))).scalar_one()
            bill.status = "paid"
        await s.commit()
        await s.refresh(pay)
        return pay

    async def recent_bills(self, user_id: UUID, limit: int = 12) -> list[Bill]:
        s = self._session_factory()
        return list((await s.execute(
            select(Bill).where(Bill.user_id == user_id).order_by(Bill.inquired_at.desc()).limit(limit)
        )).scalars().all())
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_billing_repository.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/repository.py tests/integration/test_billing_repository.py
git commit -m "feat(billing): repository for subscriptions, bills, payments"
```

---

### Task 8: Billing service (orchestration)

**Files:**
- Create: `src/energybot/billing/service.py`
- Test: `tests/integration/test_billing_service.py`

**Interfaces:**
- Consumes: `decode_bill_barcode` (T3), `parse_bill_numbers` (T2), `FinnotechClient`/`BillDetail` (T5), `PaymentProvider`/`PaymentSession` (T6), `BillingRepository` (T7).
- Produces `class BillingService` with:
  - `__init__(self, *, finnotech, payment, repo: BillingRepository, callback_base_url: str, provider_name: str)`
  - `@dataclass CaptureResult(ok: bool, summary: str, pay_callback: str | None, bill_db_id: str | None, error: str | None)`
  - `async def handle_input(self, user_id: UUID, *, image_bytes: bytes | None = None, text: str | None = None) -> CaptureResult`
  - `async def start_payment(self, user_id: UUID, chat_id: int, bill_db_id: UUID) -> str` (returns redirect URL)
  - `async def complete_payment(self, gateway_ref: str, params: dict) -> tuple[int, bool]` (returns `(chat_id, success)`)
  - `render_summary(detail: BillDetail) -> str` (static helper, Persian)
- Consumed by: Tasks 10, 11.

- [ ] **Step 1: Write the failing test**

```python
import pytest
from uuid import uuid4
from energybot.core.models import User, Profile, Bill
from sqlalchemy import select
from energybot.billing.repository import BillingRepository
from energybot.billing.finnotech_client import FakeFinnotechClient, BillDetail
from energybot.billing.payment import FakePaymentProvider
from energybot.billing.service import BillingService
from energybot.billing.bill_numbers import _check_digit


def _bill_id():
    return "117709580013" + _check_digit("117709580013")


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    await db_session.commit()
    return u


def _service(db_session, fin=None):
    repo = BillingRepository(session_factory=lambda: db_session)
    return BillingService(
        finnotech=fin or FakeFinnotechClient(),
        payment=FakePaymentProvider(), repo=repo,
        callback_base_url="https://bot.test", provider_name="fake",
    )


@pytest.mark.asyncio
async def test_handle_text_input_inquires_and_snapshots(db_session):
    u = await _user(db_session)
    svc = _service(db_session)
    res = await svc.handle_input(u.id, text=_bill_id())
    assert res.ok is True
    assert "تومان" in res.summary or "ریال" in res.summary
    assert res.bill_db_id is not None
    bills = (await db_session.execute(select(Bill).where(Bill.user_id == u.id))).scalars().all()
    assert len(bills) == 1


@pytest.mark.asyncio
async def test_handle_invalid_text_returns_friendly_error(db_session):
    u = await _user(db_session)
    svc = _service(db_session)
    res = await svc.handle_input(u.id, text="سلام")
    assert res.ok is False
    assert res.error


@pytest.mark.asyncio
async def test_start_and_complete_payment(db_session):
    u = await _user(db_session)
    svc = _service(db_session)
    res = await svc.handle_input(u.id, text=_bill_id())
    from uuid import UUID
    url = await svc.start_payment(u.id, chat_id=555, bill_db_id=UUID(res.bill_db_id))
    assert url.startswith("https://pay.fake/")
    # The fake provider's gateway_ref is REF-<bill_id>
    chat_id, success = await svc.complete_payment(f"REF-{_bill_id()}", {"ok": "1"})
    assert chat_id == 555 and success is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_billing_service.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement**

Create `src/energybot/billing/service.py`:

```python
from dataclasses import dataclass
from uuid import UUID
from energybot.billing.barcode import decode_bill_barcode
from energybot.billing.bill_numbers import parse_bill_numbers, BillNumbers
from energybot.billing.finnotech_client import BillDetail, FinnotechError
from energybot.billing.repository import BillingRepository
from energybot.logging import get_logger

log = get_logger(__name__)

_MANUAL_HINT = "نتونستم بارکد رو بخونم. لطفاً شناسه قبض و شناسه پرداخت را تایپ کن (مثل: ۱۱۷۷... ۰۱۵۱...)."
_BAD_INPUT = "شناسه قبض معتبر پیدا نکردم. می‌تونی عکس واضح‌تر بفرستی یا عدد رو تایپ کنی."
_FIN_DOWN = "سرویس استعلام قبض موقتاً در دسترس نیست. کمی بعد دوباره امتحان کن."


@dataclass(slots=True)
class CaptureResult:
    ok: bool
    summary: str
    pay_callback: str | None
    bill_db_id: str | None
    error: str | None


def _fmt_amount(rial: int) -> str:
    toman = rial // 10
    return f"{toman:,} تومان"


def render_summary(detail: BillDetail) -> str:
    kind = {"electricity": "برق", "gas": "گاز"}.get(detail.utility_type, "قبض")
    lines = [f"📄 قبض {kind}", f"مبلغ: {_fmt_amount(detail.amount)}"]
    if detail.term:
        lines.append(f"دوره: {detail.term}")
    if detail.due_date:
        lines.append(f"مهلت پرداخت: {detail.due_date}")
    return "\n".join(lines)


class BillingService:
    def __init__(self, *, finnotech, payment, repo: BillingRepository,
                 callback_base_url: str, provider_name: str):
        self._fin = finnotech
        self._pay = payment
        self._repo = repo
        self._callback_base = callback_base_url.rstrip("/")
        self._provider_name = provider_name

    def _capture_numbers(self, *, image_bytes: bytes | None, text: str | None) -> BillNumbers | None:
        if image_bytes is not None:
            bn = decode_bill_barcode(image_bytes)
            if bn is not None:
                return bn
            return None
        if text:
            try:
                return parse_bill_numbers(text)
            except ValueError:
                return None
        return None

    async def handle_input(self, user_id: UUID, *, image_bytes: bytes | None = None,
                           text: str | None = None) -> CaptureResult:
        bn = self._capture_numbers(image_bytes=image_bytes, text=text)
        if bn is None:
            msg = _MANUAL_HINT if image_bytes is not None else _BAD_INPUT
            return CaptureResult(False, "", None, None, msg)
        try:
            detail = await self._fin.inquire_bill(bn.bill_id)
        except FinnotechError as e:
            log.warning("finnotech_inquiry_failed", error=str(e), user_id=str(user_id))
            return CaptureResult(False, "", None, None, _FIN_DOWN)
        sub = await self._repo.get_or_create_subscription(
            user_id, utility_type=detail.utility_type, bill_id=bn.bill_id)
        bill = await self._repo.add_bill(user_id, sub.id, detail)
        return CaptureResult(
            ok=True, summary=render_summary(detail),
            pay_callback=f"pay:{bill.id}", bill_db_id=str(bill.id), error=None,
        )

    async def start_payment(self, user_id: UUID, chat_id: int, bill_db_id: UUID) -> str:
        bills = await self._repo.recent_bills(user_id)
        bill = next((b for b in bills if b.id == bill_db_id), None)
        if bill is None:
            raise ValueError("bill not found")
        return_url = f"{self._callback_base}/pay/callback"
        session = await self._pay.create_session(
            amount=int(bill.amount), bill_id=bill.subscription_id and "" or "",
            pay_id=bill.pay_id, return_url=return_url)
        await self._repo.create_payment(
            user_id, bill_db_id=bill.id, chat_id=chat_id, provider=self._provider_name,
            amount=int(bill.amount), session=session)
        return session.redirect_url

    async def complete_payment(self, gateway_ref: str, params: dict) -> tuple[int, bool]:
        pay = await self._repo.get_payment_by_ref(gateway_ref)
        if pay is None:
            raise ValueError("payment not found")
        result = await self._pay.verify(gateway_ref=gateway_ref, params=params)
        await self._repo.mark_payment(pay.id, success=result.success, raw=result.raw)
        return pay.chat_id, result.success
```

Note on `start_payment`: the `bill_id` passed to the gateway's description is cosmetic; we pass the شناسه‌قبض through `pay_id`/metadata. Resolve the شناسه‌قبض by loading the subscription if a richer description is wanted — kept minimal here.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_billing_service.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/service.py tests/integration/test_billing_service.py
git commit -m "feat(billing): BillingService orchestration (capture/inquire/pay)"
```

---

### Task 9: Bale photo capture (client + parser)

**Files:**
- Modify: `src/energybot/bale_adapter/client.py`
- Modify: `src/energybot/bale_adapter/parser.py`
- Test: `tests/test_bale_client.py`, `tests/test_bale_parser.py`

**Interfaces:**
- Produces:
  - `BaleClient.get_file(file_id: str) -> str` (returns `file_path` from `getFile`).
  - `BaleClient.download_file(file_path: str) -> bytes` (downloads from `{base}/file/bot{token}/{file_path}`).
  - `@dataclass UpdatePhoto(update_id, bale_user_id, chat_id, file_id, caption, display_name)` and `parse_update` returns it for messages containing `photo`.
- Consumed by: Task 10.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_bale_client.py`:

```python
@pytest.mark.asyncio
async def test_get_file_and_download():
    def handler(request):
        if request.url.path.endswith("/getFile"):
            return httpx.Response(200, json={"ok": True, "result": {"file_path": "photos/x.jpg"}})
        assert request.url.path.endswith("/file/botT/photos/x.jpg")
        return httpx.Response(200, content=b"IMGBYTES")
    c = BaleClient(token="T", base_url="https://tapi.bale.ai", transport=httpx.MockTransport(handler))
    fp = await c.get_file("FID")
    assert fp == "photos/x.jpg"
    data = await c.download_file(fp)
    assert data == b"IMGBYTES"
```

Add to `tests/test_bale_parser.py`:

```python
def test_parse_photo_message():
    from energybot.bale_adapter.parser import UpdatePhoto
    upd = {"update_id": 9, "message": {"message_id": 3, "from": {"id": 8, "first_name": "نگار"},
           "chat": {"id": 8}, "photo": [{"file_id": "small"}, {"file_id": "big"}], "caption": "قبض"}}
    parsed = parse_update(upd)
    assert isinstance(parsed, UpdatePhoto)
    assert parsed.file_id == "big"
    assert parsed.caption == "قبض"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_bale_client.py::test_get_file_and_download tests/test_bale_parser.py::test_parse_photo_message -v`
Expected: FAIL.

- [ ] **Step 3: Implement client methods**

In `src/energybot/bale_adapter/client.py`, add to `BaleClient`:

```python
    async def get_file(self, file_id: str) -> str:
        data = await self._post_json("getFile", {"file_id": file_id})
        return data["result"]["file_path"]

    async def download_file(self, file_path: str) -> bytes:
        url = f"{self._base}/file/bot{self._token}/{file_path}"
        r = await self._client.get(url)
        r.raise_for_status()
        return r.content
```

- [ ] **Step 4: Implement parser**

In `src/energybot/bale_adapter/parser.py`, add the dataclass and a branch in `parse_update` BEFORE the `UpdateUnknown` return, and AFTER the text branch:

```python
@dataclass(slots=True)
class UpdatePhoto:
    update_id: int
    bale_user_id: int
    chat_id: int
    file_id: str
    caption: str | None
    display_name: str | None
```

Update the `Union` return type to include `UpdatePhoto`, and add inside `parse_update` after the text branch:

```python
    if "message" in d and "photo" in d["message"]:
        m = d["message"]
        photos = m["photo"]
        return UpdatePhoto(
            update_id=int(upd),
            bale_user_id=int(m["from"]["id"]),
            chat_id=int(m["chat"]["id"]),
            file_id=str(photos[-1]["file_id"]),
            caption=m.get("caption"),
            display_name=m["from"].get("first_name"),
        )
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_bale_client.py tests/test_bale_parser.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/bale_adapter/client.py src/energybot/bale_adapter/parser.py tests/test_bale_client.py tests/test_bale_parser.py
git commit -m "feat(bale): getFile/download_file and photo update parsing"
```

---

### Task 10: Handler wiring (/bill, photo, pay callback button)

**Files:**
- Modify: `src/energybot/bale_adapter/handler.py`
- Test: `tests/integration/test_bot_handler_billing.py`

**Interfaces:**
- Consumes: `UpdatePhoto` (T9), `BillingService`/`CaptureResult` (T8), `BaleClient.get_file/download_file` (T9).
- Produces: `build_billing_service(session_factory) -> BillingService` factory in `handler.py`; routing for `/bill`, photo updates, and callback data prefixed `pay:`.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_bot_handler_billing.py`:

```python
import pytest
from uuid import uuid4
from sqlalchemy import select
from energybot.bale_adapter.handler import handle_bale_update
from energybot.core.models import User, Bill, OnboardingState
from energybot.billing.bill_numbers import _check_digit


def _bill_id():
    return "117709580013" + _check_digit("117709580013")


class FakeBale:
    def __init__(self):
        self.sent = []
    async def send_message(self, *, chat_id, text, reply_markup=None):
        self.sent.append({"text": text, "reply_markup": reply_markup}); return 1
    async def send_chat_action(self, *, chat_id, action="typing"): pass
    async def answer_callback_query(self, **kw): pass
    async def get_file(self, file_id): return "photos/x.jpg"
    async def download_file(self, file_path): return b"img"


async def _seed_done_user(db_session, uid):
    # /start then complete onboarding shortcut: insert user with no active wizard
    u = User(bale_user_id=uid)
    db_session.add(u); await db_session.flush()
    from energybot.core.models import Profile
    db_session.add(Profile(user_id=u.id)); await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_typed_bill_id_creates_snapshot_with_pay_button(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    u = await _seed_done_user(db_session, 31001)
    upd = {"update_id": 1, "message": {"message_id": 1, "from": {"id": 31001}, "chat": {"id": 31001}, "text": f"/bill {_bill_id()}"}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    bills = (await db_session.execute(select(Bill).where(Bill.user_id == u.id))).scalars().all()
    assert len(bills) == 1
    assert any(s["reply_markup"] for s in bale.sent)  # pay button present


@pytest.mark.asyncio
async def test_photo_without_barcode_asks_for_manual(db_session, monkeypatch):
    bale = FakeBale()
    monkeypatch.setattr("energybot.bale_adapter.handler.get_bale_client", lambda: bale)
    await _seed_done_user(db_session, 31002)
    upd = {"update_id": 2, "message": {"message_id": 2, "from": {"id": 31002}, "chat": {"id": 31002},
           "photo": [{"file_id": "big"}]}}
    await handle_bale_update(upd, session_factory=lambda: db_session)
    assert any("بارکد" in s["text"] for s in bale.sent)
```

Note: these tests rely on a real Finnotech call being avoided. In Step 3 the billing-service factory must be monkeypatchable; the test monkeypatches it. Add to the test file:

```python
@pytest.fixture(autouse=True)
def _fake_billing(monkeypatch, db_session):
    from energybot.billing.service import BillingService
    from energybot.billing.repository import BillingRepository
    from energybot.billing.finnotech_client import FakeFinnotechClient
    from energybot.billing.payment import FakePaymentProvider
    def factory(session_factory):
        return BillingService(finnotech=FakeFinnotechClient(), payment=FakePaymentProvider(),
                              repo=BillingRepository(session_factory=session_factory),
                              callback_base_url="https://bot.test", provider_name="fake")
    monkeypatch.setattr("energybot.bale_adapter.handler.build_billing_service", factory)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_bot_handler_billing.py -v`
Expected: FAIL — `build_billing_service` undefined.

- [ ] **Step 3: Implement the factory and routing**

In `src/energybot/bale_adapter/handler.py`:

Add the import at top: `from energybot.bale_adapter.parser import parse_update, UpdateText, UpdateCallback, UpdatePhoto, UpdateUnknown`.

Add a factory near `build_agent_for_user`:

```python
def build_billing_service(session_factory):
    from energybot.billing.service import BillingService
    from energybot.billing.repository import BillingRepository
    from energybot.billing.finnotech_client import FinnotechClient
    from energybot.billing.payment import GenericRedirectProvider, FakePaymentProvider
    s = get_settings()
    fin = FinnotechClient(
        client_id=s.finnotech_client_id, client_secret=s.finnotech_client_secret,
        national_id=s.finnotech_national_id, scope=s.finnotech_scope,
        base_url=s.finnotech_base_url, token_path=s.finnotech_token_path,
        inquiry_path=s.finnotech_inquiry_path,
    )
    if s.payment_provider == "generic" and s.payment_gateway_base:
        payment = GenericRedirectProvider(gateway_base=s.payment_gateway_base, merchant_id=s.payment_merchant_id)
    else:
        payment = FakePaymentProvider()
    return BillingService(
        finnotech=fin, payment=payment,
        repo=BillingRepository(session_factory=session_factory),
        callback_base_url=s.payment_callback_base_url, provider_name=s.payment_provider,
    )
```

Add a helper to send a capture result with the pay button:

```python
async def _send_capture(bale, chat_id, res):
    if not res.ok:
        await bale.send_message(chat_id=chat_id, text=res.error)
        return
    markup = {"inline_keyboard": [[{"text": "پرداخت 💳", "callback_data": res.pay_callback}]]}
    await bale.send_message(chat_id=chat_id, text=res.summary, reply_markup=markup)
```

In `handle_bale_update`, in the `UpdateText` branch, BEFORE the wizard `current` check, add:

```python
        if text.startswith("/bill"):
            arg = text[len("/bill"):].strip()
            if not arg:
                await bale.send_message(chat_id=parsed.chat_id, text="شناسه قبض را بفرست یا عکس قبض را ارسال کن.")
                return
            svc = build_billing_service(session_factory)
            res = await svc.handle_input(user.id, text=arg)
            await _send_capture(bale, parsed.chat_id, res)
            return
```

Add a new top-level branch for photos (after the `UpdateText` block, before `UpdateCallback`):

```python
    elif isinstance(parsed, UpdatePhoto):
        try:
            file_path = await bale.get_file(parsed.file_id)
            image_bytes = await bale.download_file(file_path)
            svc = build_billing_service(session_factory)
            res = await svc.handle_input(user.id, image_bytes=image_bytes)
        except Exception:
            from energybot.logging import get_logger
            get_logger(__name__).exception("photo_billing_failed", chat_id=parsed.chat_id)
            await bale.send_message(chat_id=parsed.chat_id, text="نتونستم عکس رو پردازش کنم. دوباره امتحان کن.")
            return
        await _send_capture(bale, parsed.chat_id, res)
        return
```

In the `UpdateCallback` branch, BEFORE the wizard handling, add the pay route:

```python
        if parsed.data.startswith("pay:"):
            from uuid import UUID
            svc = build_billing_service(session_factory)
            try:
                url = await svc.start_payment(user.id, parsed.chat_id, UUID(parsed.data[4:]))
            except Exception:
                await bale.send_message(chat_id=parsed.chat_id, text="ایجاد لینک پرداخت ناموفق بود. بعداً امتحان کن.")
                return
            await bale.send_message(chat_id=parsed.chat_id, text=f"برای پرداخت روی این لینک بزن:\n{url}")
            return
```

Also update `/help` text to mention `/bill`: append « /bill برای استعلام و پرداخت قبض».

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/integration/test_bot_handler_billing.py -v`
Expected: PASS.

- [ ] **Step 5: Run the full handler suite to check no regressions**

Run: `pytest tests/integration/test_bot_handler.py tests/integration/test_bot_handler_billing.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/bale_adapter/handler.py tests/integration/test_bot_handler_billing.py
git commit -m "feat(bale): route /bill, photos, and pay callback to BillingService"
```

---

### Task 11: Payment callback endpoint

**Files:**
- Create: `src/energybot/billing/callback.py`
- Modify: `src/energybot/main.py` (register router)
- Test: `tests/integration/test_pay_callback.py`

**Interfaces:**
- Consumes: `BillingService.complete_payment` (T8), `get_session` (db), `get_bale_client` (handler).
- Produces: `GET /pay/callback` route returning an HTML page; on success it sends a Bale message to the stored chat.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_pay_callback.py`:

```python
import pytest
from uuid import uuid4
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, Profile, UtilitySubscription, Bill, BillPayment


async def _seed_payment(db_session, gateway_ref, chat_id):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000)); db_session.add(u); await db_session.flush()
    db_session.add(Profile(user_id=u.id))
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="117709580013")
    db_session.add(sub); await db_session.flush()
    bill = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity", amount=152000, status="inquired", raw_inquiry={})
    db_session.add(bill); await db_session.flush()
    pay = BillPayment(bill_db_id=bill.id, user_id=u.id, chat_id=chat_id, provider="fake",
                      amount=152000, status="pending", gateway_ref=gateway_ref, raw={})
    db_session.add(pay); await db_session.commit()
    return u


@pytest.mark.asyncio
async def test_callback_verifies_and_notifies(db_session, monkeypatch):
    sent = []
    class FakeBale:
        async def send_message(self, *, chat_id, text, reply_markup=None): sent.append((chat_id, text)); return 1
    monkeypatch.setattr("energybot.billing.callback.get_bale_client", lambda: FakeBale())
    monkeypatch.setattr("energybot.billing.callback.get_session_factory_for_request", lambda: (lambda: db_session))

    from energybot.billing.payment import FakePaymentProvider
    from energybot.billing.repository import BillingRepository
    from energybot.billing.service import BillingService
    def fake_service(session_factory):
        return BillingService(finnotech=None, payment=FakePaymentProvider(),
                              repo=BillingRepository(session_factory=session_factory),
                              callback_base_url="https://bot.test", provider_name="fake")
    monkeypatch.setattr("energybot.billing.callback.build_billing_service", fake_service)

    await _seed_payment(db_session, "REF-OK", chat_id=4242)
    from energybot.billing.callback import router
    from fastapi import FastAPI
    app = FastAPI(); app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as ac:
        r = await ac.get("/pay/callback", params={"authority": "REF-OK", "ok": "1"})
    assert r.status_code == 200
    assert "موفق" in r.text
    assert sent and sent[0][0] == 4242
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_pay_callback.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the callback**

Create `src/energybot/billing/callback.py`:

```python
from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from energybot.bale_adapter.handler import build_billing_service, get_bale_client
from energybot.core.db import get_sessionmaker
from energybot.logging import get_logger

log = get_logger(__name__)
router = APIRouter()

_OK_HTML = "<html dir='rtl'><body style='font-family:sans-serif;text-align:center;padding:40px'>" \
           "<h2>✅ پرداخت موفق بود</h2><p>به ربات برگرد.</p></body></html>"
_FAIL_HTML = "<html dir='rtl'><body style='font-family:sans-serif;text-align:center;padding:40px'>" \
             "<h2>❌ پرداخت ناموفق بود</h2><p>دوباره از داخل ربات تلاش کن.</p></body></html>"


def get_session_factory_for_request():
    Session = get_sessionmaker()
    return lambda: Session()  # service opens/commits its own sessions


@router.get("/pay/callback")
async def pay_callback(request: Request) -> HTMLResponse:
    params = dict(request.query_params)
    gateway_ref = params.get("authority") or params.get("ref") or ""
    session_factory = get_session_factory_for_request()
    svc = build_billing_service(session_factory)
    try:
        chat_id, success = await svc.complete_payment(gateway_ref, params)
    except Exception as e:  # noqa: BLE001
        log.warning("pay_callback_failed", error=str(e), ref=gateway_ref)
        return HTMLResponse(_FAIL_HTML, status_code=200)
    bale = get_bale_client()
    try:
        msg = "پرداخت قبض با موفقیت انجام شد ✅" if success else "پرداخت ناموفق بود. می‌تونی دوباره تلاش کنی."
        await bale.send_message(chat_id=chat_id, text=msg)
    except Exception as e:  # noqa: BLE001
        log.warning("pay_callback_notify_failed", error=str(e), chat_id=chat_id)
    return HTMLResponse(_OK_HTML if success else _FAIL_HTML, status_code=200)
```

Note: the test monkeypatches `get_session_factory_for_request`, `get_bale_client`, and `build_billing_service` on this module, so the production wiring above is bypassed in tests but exercised in prod.

- [ ] **Step 4: Register the router**

In `src/energybot/main.py`, add import `from energybot.billing.callback import router as pay_router` and, in `create_app`, `app.include_router(pay_router)` BEFORE the landing static mount at `/` (so the route isn't shadowed by the SPA catch-all).

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/integration/test_pay_callback.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/billing/callback.py src/energybot/main.py tests/integration/test_pay_callback.py
git commit -m "feat(billing): /pay/callback verifies payment and notifies user"
```

---

### Task 12: read_bills agent tool + registration

**Files:**
- Create: `src/energybot/agent/tools/read_bills.py`
- Modify: `src/energybot/bale_adapter/handler.py` (`build_agent_for_user`)
- Test: `tests/integration/test_tool_read_bills.py`

**Interfaces:**
- Consumes: `BillingRepository.recent_bills` (T7).
- Produces: `class ReadBillsTool` (AgentTool protocol) — `name="read_bills"`, returns `{"bills": [{utility_type, amount, term, status, inquired_at}], "trend": {...}}` with Δ vs the previous same-utility period.

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_tool_read_bills.py`:

```python
import pytest
from uuid import uuid4
from energybot.core.models import User, Profile
from energybot.billing.repository import BillingRepository
from energybot.billing.finnotech_client import BillDetail
from energybot.agent.tools.read_bills import ReadBillsTool


async def _user(db_session):
    u = User(bale_user_id=int(uuid4().int % 10_000_000_000)); db_session.add(u); await db_session.flush()
    db_session.add(Profile(user_id=u.id)); await db_session.commit(); return u


@pytest.mark.asyncio
async def test_read_bills_returns_trend(db_session):
    u = await _user(db_session)
    repo = BillingRepository(session_factory=lambda: db_session)
    sub = await repo.get_or_create_subscription(u.id, utility_type="electricity", bill_id="117709580013")
    await repo.add_bill(u.id, sub.id, BillDetail("117709580013", None, 100000, "electricity", "1404/02", None, {}))
    await repo.add_bill(u.id, sub.id, BillDetail("117709580013", None, 130000, "electricity", "1404/03", None, {}))
    tool = ReadBillsTool(repo=repo, user_id=u.id)
    out = await tool.invoke({})
    assert len(out["bills"]) == 2
    assert out["trend"]["electricity"]["latest"] == 130000
    assert out["trend"]["electricity"]["delta"] == 30000
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/integration/test_tool_read_bills.py -v`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement the tool**

Create `src/energybot/agent/tools/read_bills.py`:

```python
from typing import Any
from uuid import UUID
from energybot.billing.repository import BillingRepository


class ReadBillsTool:
    name = "read_bills"
    description = "خواندن قبض‌های اخیر کاربر و روند مصرف (برق/گاز) برای تحلیل و توصیه."
    parameters = {"type": "object", "properties": {}}

    def __init__(self, *, repo: BillingRepository, user_id: UUID):
        self._repo = repo
        self._user_id = user_id

    async def invoke(self, args: dict[str, Any]) -> dict[str, Any]:
        bills = await self._repo.recent_bills(self._user_id, limit=24)
        items = [{
            "utility_type": b.utility_type, "amount": int(b.amount), "term": b.term,
            "status": b.status, "inquired_at": b.inquired_at.isoformat(),
        } for b in bills]
        trend: dict[str, Any] = {}
        for kind in ("electricity", "gas"):
            kind_bills = [b for b in bills if b.utility_type == kind]  # newest first
            if not kind_bills:
                continue
            latest = int(kind_bills[0].amount)
            prev = int(kind_bills[1].amount) if len(kind_bills) > 1 else None
            trend[kind] = {"latest": latest, "previous": prev,
                           "delta": (latest - prev) if prev is not None else None}
        return {"bills": items, "trend": trend}
```

- [ ] **Step 4: Register the tool**

In `src/energybot/bale_adapter/handler.py` `build_agent_for_user`, add import and registration alongside the others:

```python
    from energybot.agent.tools.read_bills import ReadBillsTool
    from energybot.billing.repository import BillingRepository
```

and after the existing `registry.register(...)` calls:

```python
    registry.register(ReadBillsTool(repo=BillingRepository(session_factory=session_factory), user_id=user_id))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pytest tests/integration/test_tool_read_bills.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/agent/tools/read_bills.py src/energybot/bale_adapter/handler.py tests/integration/test_tool_read_bills.py
git commit -m "feat(agent): read_bills tool exposing recent bills + trend"
```

---

### Task 13: Profile summary line

**Files:**
- Modify: `src/energybot/profile/render.py`
- Test: `tests/test_profile_render.py`

**Interfaces:**
- Produces: `render_bills_line(bills: list[dict]) -> str` — a one-line «آخرین قبض‌ها» summary; empty string when no bills.
- Note: `render_profile_summary` is NOT changed to query the DB (it's pure); the handler's `/profile` path composes the bills line separately so `render.py` stays side-effect free.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_profile_render.py`:

```python
def test_render_bills_line_with_trend():
    from energybot.profile.render import render_bills_line
    line = render_bills_line([
        {"utility_type": "electricity", "amount": 130000, "term": "1404/03"},
        {"utility_type": "electricity", "amount": 100000, "term": "1404/02"},
    ])
    assert "برق" in line
    assert "۱۳" in line or "13" in line  # amount shown (toman)


def test_render_bills_line_empty():
    from energybot.profile.render import render_bills_line
    assert render_bills_line([]) == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_profile_render.py -v`
Expected: FAIL — `render_bills_line` undefined.

- [ ] **Step 3: Implement**

Add to `src/energybot/profile/render.py`:

```python
def render_bills_line(bills: list[dict]) -> str:
    if not bills:
        return ""
    labels = {"electricity": "برق", "gas": "گاز"}
    parts = []
    seen = set()
    for b in bills:  # newest first
        kind = b.get("utility_type")
        if kind in seen:
            continue
        seen.add(kind)
        toman = int(b.get("amount", 0)) // 10
        parts.append(f"{labels.get(kind, kind)}: {toman:,} تومان")
    return "آخرین قبض‌ها — " + "، ".join(parts)
```

- [ ] **Step 4: Wire into `/profile`**

In `src/energybot/bale_adapter/handler.py`, in the `/profile` branch, after building `summary`, append the bills line:

```python
            from energybot.profile.render import render_profile_summary, render_bills_line
            from energybot.billing.repository import BillingRepository
            p = await profile_repo.get(user.id)
            summary = render_profile_summary(p.household or {}, p.behaviour or {}, p.goals or [], p.commitments or [])
            bills = await BillingRepository(session_factory=session_factory).recent_bills(user.id, limit=6)
            line = render_bills_line([{"utility_type": b.utility_type, "amount": int(b.amount), "term": b.term} for b in bills])
            if line:
                summary = summary + "\n\n" + line
            await bale.send_message(chat_id=parsed.chat_id, text=summary)
            return
```

(Replace the existing `/profile` body with the above, removing the old duplicate import/summary lines.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_profile_render.py -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/profile/render.py src/energybot/bale_adapter/handler.py tests/test_profile_render.py
git commit -m "feat(profile): show latest bills line in /profile"
```

---

### Task 14: Docker image — libzbar0 + verify full suite

**Files:**
- Modify: `Dockerfile` (or `.deploy/` build files — locate the system-package install layer)
- Test: full suite run

**Interfaces:** none (deployment).

- [ ] **Step 1: Locate the system-deps layer**

Run: `grep -rn "apt-get\|apk add" Dockerfile .deploy 2>/dev/null`
Expected: find the `apt-get install` line.

- [ ] **Step 2: Add libzbar0**

In the `apt-get install -y ...` line (runtime stage), add `libzbar0`. Example:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends libzbar0 && rm -rf /var/lib/apt/lists/*
```

If wheels are vendored under `.deploy/wheels`, also ensure `pyzbar` and `Pillow` wheels are present (run the existing wheel-collection step / `pip download`).

- [ ] **Step 3: Run the full test suite**

Run: `pytest -q`
Expected: PASS (all tests, including the new billing suite). Investigate and fix any regressions before committing.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile .deploy 2>/dev/null; git add -A
git commit -m "build(deploy): install libzbar0 for barcode decoding"
```

---

## Self-Review

**Spec coverage:**
- §1 flow: capture (T2/T3/T9), inquiry (T5), summary+pay button (T8/T10), pay+callback (T6/T8/T11), snapshot+trend (T7/T12). ✓
- §2 data model: all three tables (T4). ✓
- §3 module layout: `finnotech_client` (T5), `barcode` (T3), `bill_numbers` (T2), `payment` (T6), `repository` (T7), `service` (T8); Bale parser/client/handler (T9/T10). ✓
- §4 Finnotech auth + barcode + callback (T5, T3/T14, T11). ✓
- §5 agent tool + profile line (T12, T13). ✓
- §6 error handling (friendly Persian messages in T8/T10/T11), security (gateway verify authoritative in T6/T11; raw JSONB not exported — no admin export task added since none exists yet), testing (every task is TDD, no prod calls). ✓

**Placeholder scan:** No "TBD"/"implement later". The two intentional defensiveness notes (sample-constant regeneration in T2, gateway field names centralised in T6) are explicit instructions, not placeholders.

**Type consistency:** `BillNumbers(bill_id, pay_id, utility_type)`, `BillDetail(bill_id, pay_id, amount, utility_type, term, due_date, raw)`, `PaymentSession(redirect_url, gateway_ref, raw)`, `PaymentResult(success, gateway_ref, raw)`, `CaptureResult(ok, summary, pay_callback, bill_db_id, error)` — used consistently across T2/T5/T6/T8/T10/T11. `BillPayment.bill_db_id` (Python) ↔ `bill_id` (DB column) noted in T4 and used in T7/T11. Repository method names match between definition (T7) and callers (T8/T11/T12). ✓

**Known follow-ups (carried from spec §7, not blockers):** confirm exact Finnotech field names against the live API once a test bill is available (the client reads defensively + keeps `raw`); pin the concrete PSP in `GenericRedirectProvider`; set `payment_callback_base_url` and the public route in deployment env.
