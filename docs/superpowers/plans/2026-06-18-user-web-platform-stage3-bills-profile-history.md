# User Web Platform — Stage 3 (Bills, Profile, History) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Bills, Profile, and History-browser screens of the user web platform, each reusing existing backend services through new `/api/app/*` endpoints.

**Architecture:** New `/api/app` endpoints (gated by `current_user`, scoped-session pattern) wrap the existing `BillingService`/`BillingRepository`, `ProfileRepository` (+ the wizard's canonical household schema), and `ChatRepository`. Three new `app_ui` static-export screens consume them. No new business logic; the Bale bot keeps working unchanged.

**Tech Stack:** Python + FastAPI + SQLAlchemy async + Postgres; Next.js static export + React + Recharts; pytest unit + Postgres integration.

## Global Constraints

- Persian-only (`fa`), RTL frontend.
- All new endpoints under `/api/app/*`, gated by `current_user` (`src/energybot/user_api/auth.py`), using the scoped-session pattern: `Session = get_sessionmaker(); async with Session() as session: sf = lambda: session`. Do NOT pass the bare `get_sessionmaker()` as a session_factory (it leaks connections).
- Reuse existing services; the Bale bot behavior must not change (the `build_billing_service` extraction is behavior-preserving and regression-tested).
- The household form is driven by the wizard's `STEPS` (single source of truth); web profile edits use `source="web"`.
- Money rendered in toman (rial // 10) with thousands separators.
- venv `.venv/`; test Postgres `postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test` (run integration with `TEST_DATABASE_URL` set; `docker compose -f docker-compose.test.yml up -d`).

**Reference spec:** `docs/superpowers/specs/2026-06-18-user-web-platform-stage3-bills-profile-history-design.md`

---

## File Structure

- `src/energybot/billing/factory.py` — `build_billing_service` (extracted) (create).
- `src/energybot/bale_adapter/handler.py` — import the factory instead of defining it (modify).
- `src/energybot/billing/repository.py` — `list_subscriptions` (modify).
- `src/energybot/profile/wizard.py` — `household_field_schema()` + `normalize_household_value()` (modify).
- `src/energybot/profile/repository.py` — `remove_item` (modify).
- `src/energybot/chat/repository.py` — `list_sessions`, `session_messages`, `get_session_owned` (modify).
- `src/energybot/user_api/bills.py` — bills endpoints (create).
- `src/energybot/user_api/profile.py` — profile endpoints (create).
- `src/energybot/user_api/chat.py` — history endpoints (modify).
- `src/energybot/main.py` — include bills + profile routers (modify).
- `app_ui/src/lib/api.ts` — bills/profile/history client fns (modify across tasks).
- `app_ui/src/app/bills/page.tsx`, `app_ui/src/app/profile/page.tsx`, `app_ui/src/app/history/page.tsx` (create).
- Tests: `tests/integration/test_user_bills.py`, `test_user_profile.py`, `test_user_history.py`; `tests/test_profile_schema.py` (create).

---

### Task 1: Extract billing factory + `list_subscriptions`

**Files:**
- Create: `src/energybot/billing/factory.py`
- Modify: `src/energybot/bale_adapter/handler.py`
- Modify: `src/energybot/billing/repository.py`
- Test: `tests/integration/test_user_bills.py` (first tests)

**Interfaces:**
- Produces:
  - `build_billing_service(session_factory) -> BillingService` (in `billing/factory.py`).
  - `BillingRepository.list_subscriptions(user_id: UUID) -> list[UtilitySubscription]` (non-deleted, newest first).

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/test_user_bills.py`:

```python
import os
import pytest
from energybot.core.models import User, UtilitySubscription
from energybot.billing.repository import BillingRepository

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


@pytest.mark.asyncio
async def test_build_billing_service_importable_and_constructs(monkeypatch):
    for k, v in dict(DATABASE_URL=TEST_DB, SESSION_SECRET="z" * 32, BALE_WEBHOOK_SECRET="x",
                     BALE_BOT_TOKEN="t", FRONTIER_API_KEY="f", METIS_API_KEY="m").items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    from energybot.billing.factory import build_billing_service
    from energybot.billing.service import BillingService
    svc = build_billing_service(lambda: None)
    assert isinstance(svc, BillingService)


@pytest.mark.asyncio
async def test_list_subscriptions_excludes_deleted_newest_first(db_session):
    from datetime import datetime
    u = User(bale_user_id=601601)
    db_session.add(u)
    await db_session.flush()
    db_session.add(UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="111", label="A"))
    db_session.add(UtilitySubscription(user_id=u.id, utility_type="gas", bill_id="222", label="B"))
    dead = UtilitySubscription(user_id=u.id, utility_type="gas", bill_id="333", label="C", deleted_at=datetime.utcnow())
    db_session.add(dead)
    await db_session.commit()
    repo = BillingRepository(session_factory=lambda: db_session)
    subs = await repo.list_subscriptions(u.id)
    labels = [x.label for x in subs]
    assert "C" not in labels
    assert set(labels) == {"A", "B"}
    assert subs[0].label == "B"  # newest first (created after A)
```

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_bills.py -v`
Expected: FAIL (`ModuleNotFoundError: energybot.billing.factory`).

- [ ] **Step 3: Create the factory**

Create `src/energybot/billing/factory.py`:

```python
from collections.abc import Callable
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.settings import get_settings


def build_billing_service(session_factory: Callable[[], AsyncSession]):
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

- [ ] **Step 4: Point the Bale handler at the factory**

In `src/energybot/bale_adapter/handler.py`: delete the local `def build_billing_service(session_factory): ...` function entirely, and add to the top-level imports:

```python
from energybot.billing.factory import build_billing_service
```
The existing call sites (`build_billing_service(session_factory)`) keep working via the import.

- [ ] **Step 5: Add `list_subscriptions`**

In `src/energybot/billing/repository.py`, ensure the imports include `desc` and `UtilitySubscription` (the file imports from `sqlalchemy` and `energybot.core.models` — add `desc` to the sqlalchemy import and `UtilitySubscription` to the models import if missing). Add this method to `BillingRepository`:

```python
    async def list_subscriptions(self, user_id: UUID) -> list[UtilitySubscription]:
        s = self._session_factory()
        rows = (await s.execute(
            select(UtilitySubscription)
            .where(UtilitySubscription.user_id == user_id, UtilitySubscription.deleted_at.is_(None))
            .order_by(desc(UtilitySubscription.created_at))
        )).scalars().all()
        return list(rows)
```

- [ ] **Step 6: Run the tests + full suite (handler regression)**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_bills.py -v
.venv/bin/pytest -m "not llm" -q
```
Expected: the two new tests pass; full suite green (existing billing/handler tests unaffected by the extraction).

- [ ] **Step 7: Commit**

```bash
git add src/energybot/billing/factory.py src/energybot/bale_adapter/handler.py src/energybot/billing/repository.py tests/integration/test_user_bills.py
git commit -m "refactor(billing): extract build_billing_service to factory; add list_subscriptions"
```

---

### Task 2: Bills endpoints

**Files:**
- Create: `src/energybot/user_api/bills.py`
- Modify: `src/energybot/main.py` (include router)
- Test: `tests/integration/test_user_bills.py` (append)

**Interfaces:**
- Consumes: `build_billing_service` (Task 1), `BillingRepository.list_subscriptions`/`recent_bills`, `current_user`, `get_sessionmaker`.
- Produces: `router` with `GET /api/app/bills`, `POST /api/app/bills/inquire`, `POST /api/app/bills/{bill_db_id}/pay`. Module-level name `build_billing_service` (so tests can monkeypatch it).

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/test_user_bills.py`:

```python
from httpx import ASGITransport, AsyncClient
from energybot.user_api.tokens import mint_login_token
from energybot.billing.service import CaptureResult


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
    r = await client.post("/api/app/auth/redeem", json={"t": raw})
    return u, r.headers["x-csrf"]


@pytest.mark.asyncio
async def test_get_bills_shape(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 602602)
        db_session.add(UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="111", label="خانه"))
        await db_session.commit()
        r = await c.get("/api/app/bills")
    assert r.status_code == 200
    body = r.json()
    assert body["subscriptions"][0]["label"] == "خانه"
    assert "bills" in body


@pytest.mark.asyncio
async def test_inquire_uses_billing_service(app, db_session, monkeypatch):
    import energybot.user_api.bills as bills_mod

    class _FakeSvc:
        async def handle_input(self, user_id, *, text=None, image_bytes=None):
            return CaptureResult(ok=True, summary="📄 قبض برق", pay_callback="pay:abc",
                                 bill_db_id="abc-123", error=None)
    monkeypatch.setattr(bills_mod, "build_billing_service", lambda sf: _FakeSvc())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 603603)
        r = await c.post("/api/app/bills/inquire", json={"bill_id": "12345"}, headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "summary": "📄 قبض برق", "bill_db_id": "abc-123", "error": None}


@pytest.mark.asyncio
async def test_pay_passes_bale_user_id_as_chat_id(app, db_session, monkeypatch):
    import energybot.user_api.bills as bills_mod
    seen = {}

    class _FakeSvc:
        async def start_payment(self, user_id, chat_id, bill_db_id):
            seen["chat_id"] = chat_id
            return "https://gw.example/pay/xyz"
    monkeypatch.setattr(bills_mod, "build_billing_service", lambda sf: _FakeSvc())
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 604604)
        r = await c.post("/api/app/bills/00000000-0000-0000-0000-0000000000ab/pay", headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.json()["url"] == "https://gw.example/pay/xyz"
    assert seen["chat_id"] == 604604  # == bale_user_id


@pytest.mark.asyncio
async def test_bills_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/bills")
    assert r.status_code == 401
```

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_bills.py -v`
Expected: FAIL (no `/api/app/bills` route / import error).

- [ ] **Step 3: Create the bills router**

Create `src/energybot/user_api/bills.py`:

```python
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.billing.factory import build_billing_service
from energybot.billing.repository import BillingRepository
from energybot.logging import get_logger

router = APIRouter(prefix="/api/app", tags=["app"])


class InquireIn(BaseModel):
    bill_id: str


def _bill_dict(b) -> dict:
    return {
        "id": str(b.id), "utility_type": b.utility_type, "amount": int(b.amount),
        "term": b.term,
        "consumption": float(b.consumption) if b.consumption is not None else None,
        "due_date": b.due_date.isoformat() if b.due_date else None,
        "status": b.status, "inquired_at": b.inquired_at.isoformat(),
    }


@router.get("/bills")
async def list_bills(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        repo = BillingRepository(session_factory=lambda: session)
        subs = await repo.list_subscriptions(user.id)
        bills = await repo.recent_bills(user.id, limit=24)
        return {
            "subscriptions": [
                {"id": str(x.id), "utility_type": x.utility_type, "bill_id": x.bill_id, "label": x.label}
                for x in subs
            ],
            "bills": [_bill_dict(b) for b in bills],
        }


@router.post("/bills/inquire")
async def inquire(payload: InquireIn, user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        svc = build_billing_service(lambda: session)
        try:
            res = await svc.handle_input(user.id, text=payload.bill_id)
        except Exception:
            get_logger(__name__).exception("web_bill_inquire_failed", user_id=str(user.id))
            raise HTTPException(status_code=400, detail="در پردازش قبض مشکلی پیش اومد.")
        return {"ok": res.ok, "summary": res.summary, "bill_db_id": res.bill_db_id, "error": res.error}


@router.post("/bills/{bill_db_id}/pay")
async def pay(bill_db_id: str, user: User = Depends(current_user)):
    try:
        bid = UUID(bill_db_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    Session = get_sessionmaker()
    async with Session() as session:
        svc = build_billing_service(lambda: session)
        try:
            url = await svc.start_payment(user.id, user.bale_user_id, bid)
        except ValueError:
            raise HTTPException(status_code=404, detail="قبض یافت نشد.")
        except Exception:
            get_logger(__name__).exception("web_bill_pay_failed", user_id=str(user.id))
            raise HTTPException(status_code=400, detail="ایجاد لینک پرداخت ناموفق بود.")
        return {"url": url}
```

- [ ] **Step 4: Wire the router**

In `src/energybot/main.py`: add `from energybot.user_api.bills import router as user_bills_router` near the other user-api imports, and `app.include_router(user_bills_router)` right after `app.include_router(user_chat_router)`.

- [ ] **Step 5: Run the tests**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_bills.py -v`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/user_api/bills.py src/energybot/main.py tests/integration/test_user_bills.py
git commit -m "feat(user-web): bills endpoints (list, inquire, pay)"
```

---

### Task 3: Profile endpoints + schema helper + remove_item

**Files:**
- Modify: `src/energybot/profile/wizard.py` (`household_field_schema`, `normalize_household_value`)
- Modify: `src/energybot/profile/repository.py` (`remove_item`)
- Create: `src/energybot/user_api/profile.py`
- Modify: `src/energybot/main.py` (include router)
- Test: `tests/test_profile_schema.py`, `tests/integration/test_user_profile.py`

**Interfaces:**
- Produces:
  - `household_field_schema() -> list[dict]` — `[{key, label, options, path}]` from `STEPS`.
  - `normalize_household_value(path: str, value: str) -> Any` — raises `KeyError` (unknown path) / `ValueError` (invalid option); applies the step parser.
  - `ProfileRepository.remove_item(user_id, section, index, *, source, reason)`.
  - `router` with `GET /api/app/profile`, `PATCH /api/app/profile`, `POST /api/app/profile/{section}`, `DELETE /api/app/profile/{section}/{index}`.

- [ ] **Step 1: Write the failing schema unit test**

Create `tests/test_profile_schema.py`:

```python
import pytest
from energybot.profile.wizard import household_field_schema, normalize_household_value


def test_schema_lists_seven_household_fields():
    schema = household_field_schema()
    keys = [f["key"] for f in schema]
    assert keys == ["city", "home_type", "occupants", "area_m2", "heating_type", "cooling_type", "main_concern"]
    home = next(f for f in schema if f["key"] == "home_type")
    assert home["options"] == ["آپارتمان", "ویلایی", "مجتمع"]
    assert home["path"] == "household.home_type"
    city = next(f for f in schema if f["key"] == "city")
    assert city["options"] is None


def test_normalize_valid_select():
    assert normalize_household_value("household.home_type", "ویلایی") == "ویلایی"


def test_normalize_occupants_int():
    assert normalize_household_value("household.occupants", "5+") == 5


def test_normalize_rejects_invalid_option():
    with pytest.raises(ValueError):
        normalize_household_value("household.home_type", "قصر")


def test_normalize_unknown_path():
    with pytest.raises(KeyError):
        normalize_household_value("household.nope", "x")
```

- [ ] **Step 2: Run to verify failure**

Run: `.venv/bin/pytest tests/test_profile_schema.py -v`
Expected: FAIL (ImportError).

- [ ] **Step 3: Add the schema helpers to wizard.py**

In `src/energybot/profile/wizard.py`, after the `STEPS` / `_STEP_BY_KEY` definitions, add:

```python
_STEP_BY_PATH: dict[str, _StepDef] = {s.profile_path: s for s in STEPS}


def household_field_schema() -> list[dict]:
    return [
        {"key": s.key, "label": s.prompt, "options": s.buttons, "path": s.profile_path}
        for s in STEPS
    ]


def normalize_household_value(path: str, value: str):
    step = _STEP_BY_PATH.get(path)
    if step is None:
        raise KeyError(path)
    if step.buttons is not None and str(value) not in step.buttons:
        raise ValueError(f"invalid option for {path}: {value!r}")
    return step.parse(str(value))
```

- [ ] **Step 4: Run the schema test to verify pass**

Run: `.venv/bin/pytest tests/test_profile_schema.py -v`
Expected: 5 passed.

- [ ] **Step 5: Add `remove_item` to ProfileRepository**

In `src/energybot/profile/repository.py`, add to `ProfileRepository`:

```python
    async def remove_item(self, user_id: UUID, section: str, index: int, *, source: str, reason: str) -> None:
        if section not in ("goals", "commitments"):
            raise ValueError(f"remove_item only supports goals|commitments, got {section!r}")
        s = self._session_factory()
        p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()
        arr = list(getattr(p, section))
        if index < 0 or index >= len(arr):
            raise IndexError(index)
        removed = arr.pop(index)
        setattr(p, section, arr)
        p.completeness_score = _compute_completeness(p)
        s.add(ProfileEvent(
            user_id=user_id, field_path=f"{section}[-{index}]",
            before={"item": removed}, after=None, source=source, reason=reason,
        ))
        await s.commit()
```

- [ ] **Step 6: Write the failing profile-endpoint tests**

Create `tests/integration/test_user_profile.py`:

```python
import os
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from energybot.core.models import User, Profile, ProfileEvent
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
async def test_get_profile_includes_schema(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 701701)
        r = await c.get("/api/app/profile")
    assert r.status_code == 200
    body = r.json()
    assert body["completeness_score"] == 0
    assert [f["key"] for f in body["fields"]][0] == "city"


@pytest.mark.asyncio
async def test_patch_household_records_web_event(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 702702)
        r = await c.patch("/api/app/profile", json={"path": "household.home_type", "value": "ویلایی"},
                          headers={"x-csrf": csrf})
    assert r.status_code == 200
    assert r.json()["household"]["home_type"] == "ویلایی"
    ev = (await db_session.execute(select(ProfileEvent).where(ProfileEvent.user_id == u.id))).scalars().all()
    assert any(e.source == "web" and e.field_path == "household.home_type" for e in ev)


@pytest.mark.asyncio
async def test_patch_invalid_option_422(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 703703)
        r = await c.patch("/api/app/profile", json={"path": "household.home_type", "value": "قصر"},
                          headers={"x-csrf": csrf})
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_goals_add_and_remove(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 704704)
        r1 = await c.post("/api/app/profile/goals", json={"text": "کاهش مصرف"}, headers={"x-csrf": csrf})
        assert r1.json()["goals"] == ["کاهش مصرف"]
        r2 = await c.delete("/api/app/profile/goals/0", headers={"x-csrf": csrf})
    assert r2.status_code == 200
    assert r2.json()["goals"] == []


@pytest.mark.asyncio
async def test_bad_section_404(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, csrf = await _login(c, db_session, 705705)
        r = await c.post("/api/app/profile/behaviour", json={"text": "x"}, headers={"x-csrf": csrf})
    assert r.status_code == 404
```

- [ ] **Step 7: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_profile.py -v`
Expected: FAIL (no profile routes).

- [ ] **Step 8: Create the profile router**

Create `src/energybot/user_api/profile.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.profile.repository import ProfileRepository
from energybot.profile.wizard import household_field_schema, normalize_household_value

router = APIRouter(prefix="/api/app", tags=["app"])


class PatchIn(BaseModel):
    path: str
    value: str


class ItemIn(BaseModel):
    text: str


def _profile_dict(p) -> dict:
    return {
        "household": p.household, "behaviour": p.behaviour,
        "goals": p.goals, "commitments": p.commitments,
        "completeness_score": p.completeness_score,
        "fields": household_field_schema(),
    }


@router.get("/profile")
async def get_profile(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        p = await repo.get(user.id)
        return _profile_dict(p)


@router.patch("/profile")
async def patch_profile(payload: PatchIn, user: User = Depends(current_user)):
    try:
        normalized = normalize_household_value(payload.path, payload.value)
    except KeyError:
        raise HTTPException(status_code=422, detail="فیلد نامعتبر است.")
    except ValueError:
        raise HTTPException(status_code=422, detail="مقدار نامعتبر است.")
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        await repo.set(user.id, payload.path, normalized, source="web", reason="web edit")
        return _profile_dict(await repo.get(user.id))


@router.post("/profile/{section}")
async def add_item(section: str, payload: ItemIn, user: User = Depends(current_user)):
    if section not in ("goals", "commitments"):
        raise HTTPException(status_code=404, detail="not found")
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        await repo.append(user.id, section, payload.text, source="web", reason="web edit")
        return _profile_dict(await repo.get(user.id))


@router.delete("/profile/{section}/{index}")
async def remove_item(section: str, index: int, user: User = Depends(current_user)):
    if section not in ("goals", "commitments"):
        raise HTTPException(status_code=404, detail="not found")
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ProfileRepository(session_factory=lambda: session)
        try:
            await repo.remove_item(user.id, section, index, source="web", reason="web edit")
        except IndexError:
            raise HTTPException(status_code=404, detail="not found")
        return _profile_dict(await repo.get(user.id))
```

- [ ] **Step 9: Wire the router**

In `src/energybot/main.py`: add `from energybot.user_api.profile import router as user_profile_router` and `app.include_router(user_profile_router)` after the bills router include.

- [ ] **Step 10: Run the tests + full suite**

Run:
```bash
.venv/bin/pytest tests/test_profile_schema.py -v
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_profile.py -v
.venv/bin/pytest -m "not llm" -q
```
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/energybot/profile/wizard.py src/energybot/profile/repository.py src/energybot/user_api/profile.py src/energybot/main.py tests/test_profile_schema.py tests/integration/test_user_profile.py
git commit -m "feat(user-web): profile endpoints (view/edit household, goals, commitments)"
```

---

### Task 4: History endpoints

**Files:**
- Modify: `src/energybot/chat/repository.py` (`list_sessions`, `session_messages`, `get_session_owned`)
- Modify: `src/energybot/user_api/chat.py` (history endpoints)
- Test: `tests/integration/test_user_history.py`

**Interfaces:**
- Produces:
  - `ChatRepository.list_sessions(user_id) -> list[dict]` — `[{id, started_at, ended_at, message_count, snippet}]`, newest first.
  - `ChatRepository.session_messages(user_id, session_id) -> list[Message]` — user/assistant, oldest-first.
  - `ChatRepository.get_session_owned(user_id, session_id) -> ChatSession | None`.
  - `GET /api/app/chat/sessions`, `GET /api/app/chat/sessions/{session_id}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/test_user_history.py`:

```python
import os
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, ChatSession
from energybot.chat.repository import ChatRepository
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
    r = await client.post("/api/app/auth/redeem", json={"t": raw})
    return u, r.headers["x-csrf"]


async def _seed_session(db_session, user_id):
    sess = ChatSession(user_id=user_id)
    db_session.add(sess)
    await db_session.flush()
    repo = ChatRepository(session_factory=lambda: db_session)
    await repo.add_message(user_id, sess.id, role="user", content="سوال اول")
    await repo.add_message(user_id, sess.id, role="assistant", content="پاسخ اول")
    await repo.add_message(user_id, sess.id, role="tool", content="{}", tool_name="search_kb")
    return sess


@pytest.mark.asyncio
async def test_list_sessions_shape(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 801801)
        await _seed_session(db_session, u.id)
        r = await c.get("/api/app/chat/sessions")
    assert r.status_code == 200
    sessions = r.json()["sessions"]
    assert sessions[0]["message_count"] == 2  # tool row excluded
    assert sessions[0]["snippet"] == "سوال اول"


@pytest.mark.asyncio
async def test_session_messages_excludes_tool_rows(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u, _ = await _login(c, db_session, 802802)
        sess = await _seed_session(db_session, u.id)
        r = await c.get(f"/api/app/chat/sessions/{sess.id}")
    assert r.status_code == 200
    msgs = r.json()["messages"]
    assert [m["role"] for m in msgs] == ["user", "assistant"]


@pytest.mark.asyncio
async def test_session_not_owned_404(app, db_session):
    other = User(bale_user_id=999000)
    db_session.add(other)
    await db_session.flush()
    sess = await _seed_session(db_session, other.id)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 803803)
        r = await c.get(f"/api/app/chat/sessions/{sess.id}")
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_history.py -v`
Expected: FAIL (no routes / no `list_sessions`).

- [ ] **Step 3: Add the repository methods**

In `src/energybot/chat/repository.py`, ensure `func` is imported (`from sqlalchemy import select, desc, func`), and `ChatSession` is imported (it is). Add to `ChatRepository`:

```python
    async def list_sessions(self, user_id: UUID) -> list[dict]:
        s = self._session_factory()
        sessions = (await s.execute(
            select(ChatSession).where(ChatSession.user_id == user_id).order_by(desc(ChatSession.started_at))
        )).scalars().all()
        out: list[dict] = []
        for sess in sessions:
            count = (await s.execute(
                select(func.count()).select_from(Message).where(
                    Message.session_id == sess.id,
                    Message.role.in_(("user", "assistant")),
                    Message.deleted_at.is_(None),
                )
            )).scalar_one()
            snippet = (await s.execute(
                select(Message.content).where(
                    Message.session_id == sess.id, Message.role == "user", Message.deleted_at.is_(None)
                ).order_by(Message.id).limit(1)
            )).scalar_one_or_none()
            out.append({
                "id": str(sess.id),
                "started_at": sess.started_at.isoformat(),
                "ended_at": sess.ended_at.isoformat() if sess.ended_at else None,
                "message_count": int(count),
                "snippet": (snippet or "")[:80],
            })
        return out

    async def get_session_owned(self, user_id: UUID, session_id: UUID) -> ChatSession | None:
        s = self._session_factory()
        return (await s.execute(
            select(ChatSession).where(ChatSession.id == session_id, ChatSession.user_id == user_id)
        )).scalar_one_or_none()

    async def session_messages(self, user_id: UUID, session_id: UUID) -> list[Message]:
        s = self._session_factory()
        rows = (await s.execute(
            select(Message).where(
                Message.user_id == user_id, Message.session_id == session_id,
                Message.role.in_(("user", "assistant")), Message.deleted_at.is_(None),
            ).order_by(Message.id)
        )).scalars().all()
        return list(rows)
```

- [ ] **Step 4: Add the history endpoints**

In `src/energybot/user_api/chat.py`, append (the module already imports `UUID`, `APIRouter`, `Depends`, `HTTPException`, `get_sessionmaker`, `get_settings`, `ChatRepository`, `current_user`, `User`):

```python
@router.get("/chat/sessions")
async def chat_sessions(user: User = Depends(current_user)):
    s = get_settings()
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ChatRepository(session_factory=lambda: session, idle_minutes=s.session_idle_minutes)
        return {"sessions": await repo.list_sessions(user.id)}


@router.get("/chat/sessions/{session_id}")
async def chat_session_messages(session_id: str, user: User = Depends(current_user)):
    try:
        sid = UUID(session_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="not found")
    s = get_settings()
    Session = get_sessionmaker()
    async with Session() as session:
        repo = ChatRepository(session_factory=lambda: session, idle_minutes=s.session_idle_minutes)
        if await repo.get_session_owned(user.id, sid) is None:
            raise HTTPException(status_code=404, detail="not found")
        rows = await repo.session_messages(user.id, sid)
        return {"messages": [
            {"id": m.id, "role": m.role, "content": m.content, "created_at": m.created_at.isoformat()}
            for m in rows
        ]}
```

> Confirm `chat.py` imports `HTTPException` and `User` (the media endpoint from Stage 2 uses both). If `HTTPException` is missing from the `fastapi` import line, add it.

- [ ] **Step 5: Run the tests + full suite**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_history.py -v
.venv/bin/pytest -m "not llm" -q
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/chat/repository.py src/energybot/user_api/chat.py tests/integration/test_user_history.py
git commit -m "feat(user-web): chat session list + per-session transcript endpoints"
```

---

### Task 5: Frontend — Bills screen (+ Recharts)

**Files:**
- Modify: `app_ui/src/lib/api.ts` (bills fns)
- Create: `app_ui/src/app/bills/page.tsx`
- Modify: `app_ui/package.json` (recharts dependency)

**Interfaces:** consumes `GET /bills`, `POST /bills/inquire`, `POST /bills/{id}/pay`.

> Verification is `npm run build` + `npx tsc --noEmit` (exit 0) + the in-process serve smoke for `/app/bills/`. No FE unit tests in this repo.

- [ ] **Step 1: Add Recharts**

Run: `cd app_ui && npm install recharts && cd ..`
Confirm `recharts` appears in `app_ui/package.json` dependencies.

- [ ] **Step 2: Add the bills API client functions**

Append to `app_ui/src/lib/api.ts`:

```ts
export type Subscription = { id: string; utility_type: string; bill_id: string; label: string | null };
export type BillRow = {
  id: string; utility_type: string; amount: number; term: string | null;
  consumption: number | null; due_date: string | null; status: string; inquired_at: string;
};

export async function getBills(): Promise<{ subscriptions: Subscription[]; bills: BillRow[] }> {
  const r = await req("/bills");
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function inquireBill(billId: string): Promise<{ ok: boolean; summary: string; bill_db_id: string | null; error: string | null }> {
  const r = await req("/bills/inquire", { method: "POST", body: JSON.stringify({ bill_id: billId }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}

export async function payBill(billDbId: string): Promise<string> {
  const r = await req(`/bills/${billDbId}/pay`, { method: "POST" });
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).url;
}
```

- [ ] **Step 3: Build the bills page**

Create `app_ui/src/app/bills/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getBills, inquireBill, payBill, type Subscription, type BillRow } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const UTIL = (t: string) => (t === "electricity" ? "برق" : t === "gas" ? "گاز" : "قبض");
const toman = (rial: number) => `${Math.floor(rial / 10).toLocaleString("fa-IR")} تومان`;

export default function BillsPage() {
  const [subs, setSubs] = useState<Subscription[]>([]);
  const [bills, setBills] = useState<BillRow[]>([]);
  const [billId, setBillId] = useState("");
  const [result, setResult] = useState<{ summary: string; bill_db_id: string | null; error: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const d = await getBills();
    setSubs(d.subscriptions);
    setBills(d.bills);
  }
  useEffect(() => { refresh().catch(() => {}); }, []);

  async function onInquire() {
    const id = billId.trim();
    if (!id || busy) return;
    setBusy(true);
    try {
      const res = await inquireBill(id);
      setResult({ summary: res.summary, bill_db_id: res.ok ? res.bill_db_id : null, error: res.ok ? null : res.error });
      if (res.ok) { setBillId(""); refresh().catch(() => {}); }
    } catch { setResult({ summary: "", bill_db_id: null, error: "خطا در ارتباط با سرور" }); }
    finally { setBusy(false); }
  }

  async function onPay(id: string) {
    try { const url = await payBill(id); window.open(url, "_blank"); }
    catch { setResult({ summary: "", bill_db_id: null, error: "ایجاد لینک پرداخت ناموفق بود." }); }
  }

  const chartData = bills
    .filter((b) => b.consumption != null && b.term)
    .slice().reverse()
    .map((b) => ({ term: b.term as string, consumption: b.consumption as number }));

  return (
    <AppShell>
      <div dir="rtl" className="space-y-6">
        <h1 className="text-lg font-semibold">قبض‌ها</h1>

        <section className="space-y-2">
          <div className="flex gap-2">
            <input value={billId} onChange={(e) => setBillId(e.target.value)} placeholder="شناسهٔ قبض را وارد کن"
              className="flex-1 rounded-md border px-3 py-2 text-sm" />
            <button onClick={onInquire} disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground disabled:opacity-50">استعلام</button>
          </div>
          {result && (
            <div className="rounded-md border p-3 text-sm">
              {result.error ? <p className="text-red-500">{result.error}</p> : <pre className="whitespace-pre-wrap font-sans">{result.summary}</pre>}
              {result.bill_db_id && (
                <button onClick={() => onPay(result.bill_db_id!)} className="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">پرداخت 💳</button>
              )}
              {result.bill_db_id && <p className="mt-1 text-xs text-muted-foreground">پس از پرداخت، تأیید در ربات بله هم برایت ارسال می‌شود.</p>}
            </div>
          )}
        </section>

        {subs.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">اشتراک‌ها</h2>
            <ul className="space-y-1 text-sm">
              {subs.map((s) => <li key={s.id} className="rounded-md border px-3 py-2">{UTIL(s.utility_type)} — {s.label || s.bill_id}</li>)}
            </ul>
          </section>
        )}

        {chartData.length >= 2 && (
          <section>
            <h2 className="mb-2 text-sm font-medium">روند مصرف</h2>
            <div style={{ width: "100%", height: 220 }}>
              <ResponsiveContainer>
                <LineChart data={chartData}>
                  <XAxis dataKey="term" /><YAxis /><Tooltip /><Line type="monotone" dataKey="consumption" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-2 text-sm font-medium">تاریخچهٔ قبض‌ها</h2>
          {bills.length === 0 ? (
            <p className="text-sm text-muted-foreground">هنوز قبضی ثبت نشده — یک شناسهٔ قبض وارد کن.</p>
          ) : (
            <table className="w-full text-right text-sm">
              <thead><tr className="text-muted-foreground"><th className="py-1">نوع</th><th>دوره</th><th>مبلغ</th><th>مصرف</th><th>وضعیت</th></tr></thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-t">
                    <td className="py-1">{UTIL(b.utility_type)}</td><td>{b.term || "-"}</td>
                    <td>{toman(b.amount)}</td><td>{b.consumption ?? "-"}</td><td>{b.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 4: Build + typecheck + smoke**

Run:
```bash
cd app_ui && npx tsc --noEmit && npm run build && cd ..
ls app_ui/out/bills/index.html
```
Then the in-process serve smoke:
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
        r = await c.get("/app/bills/")
        assert r.status_code == 200 and "html" in r.headers.get("content-type","")
    print("SMOKE OK")
asyncio.run(main())
PY
```
Expected: `tsc` exit 0, build succeeds, `out/bills/index.html` exists, `SMOKE OK`.

- [ ] **Step 5: Commit**

```bash
git add app_ui/src/lib/api.ts app_ui/src/app/bills/page.tsx app_ui/package.json app_ui/package-lock.json
git commit -m "feat(app_ui): /app/bills screen (subscriptions, history, trend, inquire, pay)"
```

---

### Task 6: Frontend — Profile screen

**Files:**
- Modify: `app_ui/src/lib/api.ts` (profile fns)
- Create: `app_ui/src/app/profile/page.tsx`

**Interfaces:** consumes `GET /profile`, `PATCH /profile`, `POST /profile/{section}`, `DELETE /profile/{section}/{index}`.

- [ ] **Step 1: Add profile API client functions**

Append to `app_ui/src/lib/api.ts`:

```ts
export type ProfileField = { key: string; label: string; options: string[] | null; path: string };
export type ProfileData = {
  household: Record<string, unknown>; behaviour: Record<string, unknown>;
  goals: string[]; commitments: string[]; completeness_score: number; fields: ProfileField[];
};

export async function getProfile(): Promise<ProfileData> {
  const r = await req("/profile");
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function patchProfile(path: string, value: string): Promise<ProfileData> {
  const r = await req("/profile", { method: "PATCH", body: JSON.stringify({ path, value }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function addProfileItem(section: "goals" | "commitments", text: string): Promise<ProfileData> {
  const r = await req(`/profile/${section}`, { method: "POST", body: JSON.stringify({ text }) });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
export async function removeProfileItem(section: "goals" | "commitments", index: number): Promise<ProfileData> {
  const r = await req(`/profile/${section}/${index}`, { method: "DELETE" });
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
```

- [ ] **Step 2: Build the profile page**

Create `app_ui/src/app/profile/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getProfile, patchProfile, addProfileItem, removeProfileItem, type ProfileData } from "@/lib/api";

// occupants is stored normalized to an int (e.g. "5+" -> 5); map back to the option label.
function fieldValue(p: ProfileData, key: string): string {
  const v = (p.household as Record<string, unknown>)[key];
  if (v == null) return "";
  if (key === "occupants") { const n = Number(v); return n >= 5 ? "5+" : String(n); }
  return String(v);
}

export default function ProfilePage() {
  const [p, setP] = useState<ProfileData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [goalText, setGoalText] = useState("");
  const [commitText, setCommitText] = useState("");

  useEffect(() => { getProfile().then(setP).catch(() => {}); }, []);
  if (!p) return <AppShell><p className="text-sm">در حال بارگذاری…</p></AppShell>;

  async function save(path: string, value: string) {
    setErr(null);
    try { setP(await patchProfile(path, value)); }
    catch { setErr("ذخیره نشد؛ مقدار نامعتبر است."); getProfile().then(setP).catch(() => {}); }
  }

  const behaviourEntries = Object.entries(p.behaviour || {});

  return (
    <AppShell>
      <div dir="rtl" className="space-y-6 max-w-xl">
        <h1 className="text-lg font-semibold">پروفایل</h1>

        <div>
          <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>تکمیل پروفایل</span><span>{p.completeness_score}٪</span></div>
          <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${p.completeness_score}%` }} /></div>
        </div>

        {err && <p className="text-sm text-red-500">{err}</p>}

        <section className="space-y-3">
          <h2 className="text-sm font-medium">مشخصات خانه</h2>
          {p.fields.map((f) => (
            <label key={f.key} className="block text-sm">
              <span className="mb-1 block text-muted-foreground">{f.label}</span>
              {f.options ? (
                <select value={fieldValue(p, f.key)} onChange={(e) => save(f.path, e.target.value)}
                  className="w-full rounded-md border px-3 py-2">
                  <option value="" disabled>انتخاب کن…</option>
                  {f.options.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input defaultValue={fieldValue(p, f.key)} onBlur={(e) => { if (e.target.value.trim()) save(f.path, e.target.value.trim()); }}
                  className="w-full rounded-md border px-3 py-2" />
              )}
            </label>
          ))}
        </section>

        <ChipSection title="اهداف" items={p.goals} value={goalText} setValue={setGoalText}
          onAdd={async (t) => setP(await addProfileItem("goals", t))}
          onRemove={async (i) => setP(await removeProfileItem("goals", i))} empty="هنوز هدفی ثبت نشده" />

        <ChipSection title="تعهدها" items={p.commitments} value={commitText} setValue={setCommitText}
          onAdd={async (t) => setP(await addProfileItem("commitments", t))}
          onRemove={async (i) => setP(await removeProfileItem("commitments", i))} empty="هنوز تعهدی ثبت نشده" />

        {behaviourEntries.length > 0 && (
          <section>
            <h2 className="mb-1 text-sm font-medium">عادت‌ها <span className="text-xs text-muted-foreground">(به‌صورت خودکار از گفتگوها یاد گرفته شده)</span></h2>
            <ul className="text-sm text-muted-foreground">
              {behaviourEntries.map(([k, v]) => <li key={k}>{k}: {String(v)}</li>)}
            </ul>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function ChipSection(props: {
  title: string; items: string[]; value: string; setValue: (s: string) => void; empty: string;
  onAdd: (t: string) => Promise<void>; onRemove: (i: number) => Promise<void>;
}) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium">{props.title}</h2>
      {props.items.length === 0 && <p className="text-sm text-muted-foreground">{props.empty}</p>}
      <div className="flex flex-wrap gap-2">
        {props.items.map((it, i) => (
          <span key={i} className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm">
            {it}<button onClick={() => props.onRemove(i).catch(() => {})} className="text-muted-foreground hover:text-foreground">✕</button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input value={props.value} onChange={(e) => props.setValue(e.target.value)} placeholder="افزودن…"
          className="flex-1 rounded-md border px-3 py-2 text-sm" />
        <button onClick={async () => { const t = props.value.trim(); if (t) { await props.onAdd(t).catch(() => {}); props.setValue(""); } }}
          className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">افزودن</button>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Build + typecheck + smoke**

Run:
```bash
cd app_ui && npx tsc --noEmit && npm run build && cd ..
ls app_ui/out/profile/index.html
```
Then the serve smoke (same script as Task 5 Step 4 but `GET /app/profile/`). Expected: `tsc` exit 0, build ok, `out/profile/index.html` exists, `SMOKE OK`.

- [ ] **Step 4: Commit**

```bash
git add app_ui/src/lib/api.ts app_ui/src/app/profile/page.tsx
git commit -m "feat(app_ui): /app/profile screen (household form, goals, commitments)"
```

---

### Task 7: Frontend — History screen

**Files:**
- Modify: `app_ui/src/lib/api.ts` (history fns)
- Create: `app_ui/src/app/history/page.tsx`

**Interfaces:** consumes `GET /chat/sessions`, `GET /chat/sessions/{id}`.

- [ ] **Step 1: Add history API client functions**

Append to `app_ui/src/lib/api.ts` (reuses the `ChatMsg` type added in Stage 2):

```ts
export type SessionRow = { id: string; started_at: string; ended_at: string | null; message_count: number; snippet: string };

export async function getSessions(): Promise<SessionRow[]> {
  const r = await req("/chat/sessions");
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).sessions;
}
export async function getSessionMessages(id: string): Promise<ChatMsg[]> {
  const r = await req(`/chat/sessions/${id}`);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()).messages;
}
```

- [ ] **Step 2: Build the history page**

Create `app_ui/src/app/history/page.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getSessions, getSessionMessages, type SessionRow, type ChatMsg } from "@/lib/api";

const faDate = (iso: string) => new Date(iso).toLocaleDateString("fa-IR", { year: "numeric", month: "long", day: "numeric" });

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);

  useEffect(() => {
    getSessions().then((s) => {
      setSessions(s);
      const q = new URLSearchParams(window.location.search).get("s");
      if (q) setSelected(q);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!selected) { setMessages([]); return; }
    getSessionMessages(selected).then(setMessages).catch(() => setMessages([]));
    const u = new URL(window.location.href);
    u.searchParams.set("s", selected);
    window.history.replaceState(null, "", u.toString());
  }, [selected]);

  return (
    <AppShell>
      <div dir="rtl" className="flex gap-4 h-[calc(100vh-8rem)]">
        <aside className={`${selected ? "hidden md:block" : "block"} w-full md:w-72 shrink-0 overflow-y-auto border-s pe-2`}>
          <h1 className="mb-2 text-lg font-semibold">تاریخچه</h1>
          {sessions.length === 0 && <p className="text-sm text-muted-foreground">هنوز گفتگویی نداری.</p>}
          <ul className="space-y-1">
            {sessions.map((s) => (
              <li key={s.id}>
                <button onClick={() => setSelected(s.id)}
                  className={`w-full rounded-md px-3 py-2 text-right text-sm hover:bg-muted ${selected === s.id ? "bg-muted" : ""}`}>
                  <div className="truncate">{s.snippet || "گفتگو"}</div>
                  <div className="text-xs text-muted-foreground">{faDate(s.started_at)} · {s.message_count} پیام</div>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <main className={`${selected ? "block" : "hidden md:block"} flex-1 overflow-y-auto`}>
          {selected && (
            <button onClick={() => setSelected(null)} className="mb-2 text-sm text-muted-foreground hover:text-foreground md:hidden">‹ بازگشت</button>
          )}
          {!selected ? (
            <p className="hidden md:block text-sm text-muted-foreground">یک گفتگو را انتخاب کن.</p>
          ) : (
            <div className="space-y-3">
              {messages.map((m) => {
                const mine = m.role === "user";
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap ${mine ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{m.content}</div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Build + typecheck + smoke**

Run:
```bash
cd app_ui && npx tsc --noEmit && npm run build && cd ..
ls app_ui/out/history/index.html
```
Then the serve smoke (same script, `GET /app/history/`). Expected: `tsc` exit 0, build ok, `out/history/index.html` exists, `SMOKE OK`.

- [ ] **Step 4: Commit**

```bash
git add app_ui/src/lib/api.ts app_ui/src/app/history/page.tsx
git commit -m "feat(app_ui): /app/history session browser"
```

---

## Self-Review

**Spec coverage:**
- §4.1 billing factory extraction → Task 1. ✓
- §4.2 `list_subscriptions` → Task 1. ✓
- §4.3 `list_sessions`/`session_messages` (+ ownership) → Task 4. ✓
- §4.4 `remove_item` → Task 3. ✓
- §4.5 household schema from `wizard.STEPS` → Task 3. ✓
- §5.1 bills endpoints → Task 2. ✓
- §5.2 profile endpoints → Task 3. ✓
- §5.3 history endpoints → Task 4. ✓
- §6.1 bills screen + Recharts → Task 5. ✓
- §6.2 profile screen → Task 6. ✓
- §6.3 history screen → Task 7. ✓
- §7 error handling (inquiry error, pay 400, 422, 401) → Tasks 2/3 (endpoints) + 5/6 (UI). ✓
- §8 testing → each task's tests. ✓

**Placeholder scan:** No "TBD"/"similar to"/"add error handling". The `>` notes (import-presence checks) are concrete verification steps.

**Type consistency:** `build_billing_service(sf)` consistent (Tasks 1, 2). `CaptureResult` fields (`ok, summary, pay_callback, bill_db_id, error`) match the real dataclass used in Task 2 tests. `household_field_schema()`→`{key,label,options,path}` and `normalize_household_value(path,value)` consistent (Task 3 + frontend Task 6). `list_sessions`→`{id,started_at,ended_at,message_count,snippet}` consistent (Task 4 + frontend Task 7). Frontend `ChatMsg` type reused from Stage 2 (Task 7). Money `toman` = `rial//10` (Task 5) matches backend `_fmt_amount`.

## Notes for later (not part of this plan)
- Stage 4: dashboard aggregate + screen.
- Carryover deferrals (lazy `last_seen_at`, true token streaming, historical media, stable bubble keys, etc.).
