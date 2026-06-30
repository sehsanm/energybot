# Admin Bill Viewer + Suggestion Regenerate/Send — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin view a user's bills and their AI suggestions, regenerate the suggestions for a bill (preview), and send the result to the user via Bale.

**Architecture:** Reuse the existing suggestion pipeline. Split `billing/suggestions.py` so the LLM-call+parse is a reusable helper; add a force-regenerate path (overwrites stored suggestions, no posting/goals) and a send path (posts to the user's Bale chat, then replaces that bill's profile goals). Expose three admin endpoints in a new `admin_api/bills.py` router, and add a "Bills" section to the admin user-detail page.

**Tech Stack:** Python 3 / FastAPI / SQLAlchemy async / Postgres; Next.js (static export) admin UI with the existing `@/lib/api` client and shadcn-style UI components.

## Global Constraints

- All admin endpoints are guarded by `current_admin` (cookie session + `x-csrf` header on POST). The `@/lib/api` `request()` helper attaches `x-csrf` automatically; integration tests must pass the `x-csrf` header captured from `/api/admin/login`.
- Persian-only user-facing copy.
- For Bale private chats, the user's chat id is `user.bale_user_id`.
- Suggestion-derived goals are dict objects with `source == "bill_suggestion"` and `bill_id == str(bill.id)`. Other goals (including web-added plain strings) must be preserved untouched.
- Do not change the existing bot suggestion behavior (first-time generate-if-absent → append goals → post). Its regression tests in `tests/integration/test_bill_suggestions.py` must stay green.
- Run Python tests with the test DB already used by the suite: `tests/integration/*` resolve `TEST_DATABASE_URL` (default `postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test`).

---

### Task 1: `ProfileRepository.replace_bill_goals`

Goal replacement lives in `ProfileRepository` (it already owns `append`/`remove_item` for goals), not the billing repo — this keeps goal mutation in one place.

**Files:**
- Modify: `src/energybot/profile/repository.py` (add method to `ProfileRepository`)
- Test: `tests/integration/test_user_profile.py` (add one test)

**Interfaces:**
- Produces: `async ProfileRepository.replace_bill_goals(user_id: UUID, bill_id: str, new_goals: list[dict]) -> None`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/test_user_profile.py`:

```python
async def test_replace_bill_goals_swaps_only_matching_bill(db_session):
    from uuid import uuid4
    from energybot.core.models import User, Profile
    from energybot.profile.repository import ProfileRepository
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    db_session.add(Profile(user_id=u.id, goals=[
        "هدف دستی",  # plain string goal — must survive
        {"id": "a", "text": "old", "source": "bill_suggestion", "bill_id": "BILL1"},
        {"id": "b", "text": "keep", "source": "bill_suggestion", "bill_id": "BILL2"},
    ]))
    await db_session.commit()
    repo = ProfileRepository(session_factory=lambda: db_session)
    await repo.replace_bill_goals(u.id, "BILL1", [{"id": "c", "text": "new", "source": "bill_suggestion", "bill_id": "BILL1"}])
    prof = await repo.get(u.id)
    texts = [g if isinstance(g, str) else g["text"] for g in prof.goals]
    assert "هدف دستی" in texts and "keep" in texts and "new" in texts
    assert "old" not in texts
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/integration/test_user_profile.py::test_replace_bill_goals_swaps_only_matching_bill -v`
Expected: FAIL with `AttributeError: 'ProfileRepository' object has no attribute 'replace_bill_goals'`

- [ ] **Step 3: Write minimal implementation**

In `src/energybot/profile/repository.py`, add this method to the `ProfileRepository` class (next to `append`/`remove_item`). `select`, `Profile`, `ProfileEvent`, and `_compute_completeness` are already imported/defined in this module (used by `append`).

```python
    async def replace_bill_goals(self, user_id: UUID, bill_id: str, new_goals: list[dict]) -> None:
        s = self._session_factory()
        p = (await s.execute(select(Profile).where(Profile.user_id == user_id))).scalar_one()
        current = list(p.goals or [])
        kept = [g for g in current if not (
            isinstance(g, dict) and g.get("source") == "bill_suggestion" and g.get("bill_id") == bill_id
        )]
        p.goals = kept + list(new_goals)
        p.completeness_score = _compute_completeness(p)
        s.add(ProfileEvent(
            user_id=user_id, field_path="goals[bill_suggestion]",
            before={"removed": len(current) - len(kept)}, after={"added": len(new_goals)},
            source="bill_suggestion", reason="بازتولید پیشنهادهای قبض",
        ))
        await s.commit()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/integration/test_user_profile.py::test_replace_bill_goals_swaps_only_matching_bill -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/energybot/profile/repository.py tests/integration/test_user_profile.py
git commit -m "feat(profile): replace_bill_goals to swap a bill's suggestion goals"
```

---

### Task 2: Refactor suggestion generation + add `regenerate_suggestions`

Extract the LLM-call+parse into `_render_and_parse`, route the existing bot path through it (no behavior change), and add a force-regenerate entry point that overwrites stored suggestions and returns the payload.

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/integration/test_bill_suggestions.py` (add tests; existing ones must still pass)

**Interfaces:**
- Consumes: `_build_suggestion_context`, `_parse_suggestions_json`, `_build_targets_as_goals`, `render_suggestions` (existing in this module); `BillingRepository.{get_bill_by_id,prior_bills_for_subscription,set_bill_suggestions}`, `ProfileRepository.get` (existing).
- Produces:
  - `async _render_and_parse(bill, profile, prev, *, router, prompt_loader) -> dict | None`
  - `async regenerate_suggestions(*, bill_db_id: UUID, session_factory=None, router=None, prompt_loader=None) -> dict | None`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/test_bill_suggestions.py` (reuses `_user_profile_bill`, `_FakeRouter`, `_FakeLoader`, `_GOOD` already defined in that file):

```python
async def test_regenerate_overwrites_and_returns_payload(db_session):
    from energybot.billing.suggestions import regenerate_suggestions
    from energybot.billing.repository import BillingRepository
    u, b = await _user_profile_bill(db_session)
    await BillingRepository(session_factory=lambda: db_session).set_bill_suggestions(
        b.id, {"intro": "old", "tips": [], "targets": []})
    router, loader = _FakeRouter(_GOOD), _FakeLoader()
    payload = await regenerate_suggestions(
        bill_db_id=b.id, session_factory=lambda: db_session, router=router, prompt_loader=loader)
    assert router.calls == 1
    assert payload["intro"] == "مصرفت بالاست"
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions["intro"] == "مصرفت بالاست"  # overwritten
    # regenerate must NOT touch goals
    prof = await ProfileRepository(session_factory=lambda: db_session).get(u.id)
    assert prof.goals == []


async def test_regenerate_returns_none_on_parse_failure(db_session):
    from energybot.billing.suggestions import regenerate_suggestions
    u, b = await _user_profile_bill(db_session)
    payload = await regenerate_suggestions(
        bill_db_id=b.id, session_factory=lambda: db_session,
        router=_FakeRouter("not json"), prompt_loader=_FakeLoader())
    assert payload is None
    row = (await db_session.execute(select(Bill).where(Bill.id == b.id))).scalar_one()
    assert row.suggestions is None  # nothing written
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/integration/test_bill_suggestions.py::test_regenerate_overwrites_and_returns_payload -v`
Expected: FAIL with `ImportError: cannot import name 'regenerate_suggestions'`

- [ ] **Step 3: Write minimal implementation**

In `src/energybot/billing/suggestions.py`, add the helpers and refactor `_generate`. First add (above `_generate`):

```python
async def _render_and_parse(bill, profile, prev, *, router, prompt_loader) -> dict | None:
    try:
        body, key, version = await prompt_loader.render(
            "bill_suggestions", _build_suggestion_context(bill, profile, prev))
        req = ChatRequest(model="", messages=[ChatMessage(role="user", content=body)])
        resp = await router.chat(call_type="bill_suggestions", req=req,
                                 prompt_key=key, prompt_version=version)
    except Exception as e:  # noqa: BLE001 — provider/render failures are non-fatal
        log.warning("bill_suggestions_failed", error=str(e), bill_id=str(bill.id))
        return None
    parsed = _parse_suggestions_json(resp.content)
    if parsed is None:
        log.warning("bill_suggestions_parse_failed", bill_id=str(bill.id))
        return None
    return {
        "generated_at": datetime.utcnow().isoformat(),
        "intro": parsed["intro"], "tips": parsed["tips"], "targets": parsed["targets"],
        "model": resp.model, "prompt_version": version,
    }


def _default_router(sf):
    from energybot.providers.factory import build_providers
    from energybot.providers.router import ProviderRouter
    from energybot.settings import get_settings
    return ProviderRouter(providers=build_providers(get_settings()), session_factory=sf)


def _default_loader(sf):
    from energybot.agent.prompts import PromptLoader
    return PromptLoader(session_factory=sf)
```

Then replace the body of `_generate` from the `if router is None:` block through the end of the function (the LLM call, parse, and payload-build) with:

```python
    if router is None:
        router = _default_router(sf)
    if prompt_loader is None:
        prompt_loader = _default_loader(sf)

    payload = await _render_and_parse(bill, profile, prev, router=router, prompt_loader=prompt_loader)
    if payload is None:
        return
    claimed = await billing_repo.set_bill_suggestions_if_absent(bill.id, payload)
    if not claimed:
        return  # another task already generated for this bill; it will send.
    for goal in _build_targets_as_goals(payload["targets"], str(bill.id)):
        await profile_repo.append(user_id, "goals", goal,
                                  source="bill_suggestion", reason="هدف پیشنهادی از روی قبض")
    await bale.send_message(chat_id=chat_id, text=render_suggestions(payload))
```

Then add the new public function (e.g. after `generate_and_send_suggestions`):

```python
async def _regenerate(sf, *, bill_db_id, router, prompt_loader):
    from energybot.billing.repository import BillingRepository
    from energybot.profile.repository import ProfileRepository
    billing_repo = BillingRepository(session_factory=sf)
    bill = await billing_repo.get_bill_by_id(bill_db_id)
    if bill is None:
        return None
    profile = await ProfileRepository(session_factory=sf).get(bill.user_id)
    prior = await billing_repo.prior_bills_for_subscription(
        bill.subscription_id, before_bill_id=bill.id, limit=1)
    prev = prior[0] if prior else None
    router = router or _default_router(sf)
    prompt_loader = prompt_loader or _default_loader(sf)
    payload = await _render_and_parse(bill, profile, prev, router=router, prompt_loader=prompt_loader)
    if payload is None:
        return None
    await billing_repo.set_bill_suggestions(bill.id, payload)
    return payload


async def regenerate_suggestions(*, bill_db_id: UUID, session_factory=None, router=None, prompt_loader=None) -> dict | None:
    if session_factory is not None:
        return await _regenerate(session_factory, bill_db_id=bill_db_id, router=router, prompt_loader=prompt_loader)
    from energybot.core.db import get_sessionmaker
    Session = get_sessionmaker()
    async with Session() as session:
        return await _regenerate(lambda: session, bill_db_id=bill_db_id, router=router, prompt_loader=prompt_loader)
```

- [ ] **Step 4: Run tests to verify pass (new + regression)**

Run: `python -m pytest tests/integration/test_bill_suggestions.py tests/test_bill_suggestions.py -v`
Expected: PASS (new regenerate tests + all existing generate/idempotent/parse-failure tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/integration/test_bill_suggestions.py
git commit -m "feat(suggestions): regenerate_suggestions force path + extract render helper"
```

---

### Task 3: `send_suggestions`

Post the stored suggestions to the user's Bale chat, then replace that bill's profile goals. Post first so a failed send leaves goals untouched.

**Files:**
- Modify: `src/energybot/billing/suggestions.py`
- Test: `tests/integration/test_bill_suggestions.py`

**Interfaces:**
- Consumes: `BillingRepository.get_bill_by_id`, `ProfileRepository.replace_bill_goals` (Task 1), `_build_targets_as_goals`, `render_suggestions`, `User.bale_user_id`.
- Produces: `async send_suggestions(*, bill_db_id: UUID, session_factory=None, bale=None) -> bool`

- [ ] **Step 1: Write the failing test**

Append to `tests/integration/test_bill_suggestions.py`:

```python
async def test_send_posts_to_user_and_replaces_goals(db_session):
    from energybot.billing.suggestions import send_suggestions
    from energybot.billing.repository import BillingRepository
    u, b = await _user_profile_bill(db_session)
    # Seed a stale bill-goal that must be replaced, plus an unrelated goal that must survive.
    prof_repo = ProfileRepository(session_factory=lambda: db_session)
    await prof_repo.replace_bill_goals(u.id, str(b.id), [
        {"id": "stale", "text": "هدف قدیمی", "source": "bill_suggestion", "bill_id": str(b.id)}])
    await prof_repo.append(u.id, "goals", "هدف دستی", source="manual", reason="x")
    await BillingRepository(session_factory=lambda: db_session).set_bill_suggestions(b.id, {
        "intro": "x", "tips": [], "targets": [{"text": "هدف تازه", "saving_kwh": 5}]})
    bale = _FakeBale()
    ok = await send_suggestions(bill_db_id=b.id, session_factory=lambda: db_session, bale=bale)
    assert ok is True
    assert bale.sent and bale.sent[0]  # posted to user
    prof = await prof_repo.get(u.id)
    texts = [g if isinstance(g, str) else g["text"] for g in prof.goals]
    assert "هدف تازه" in texts and "هدف دستی" in texts
    assert "هدف قدیمی" not in texts


async def test_send_returns_false_when_no_suggestions(db_session):
    from energybot.billing.suggestions import send_suggestions
    u, b = await _user_profile_bill(db_session)  # suggestions is None
    bale = _FakeBale()
    ok = await send_suggestions(bill_db_id=b.id, session_factory=lambda: db_session, bale=bale)
    assert ok is False
    assert bale.sent == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/integration/test_bill_suggestions.py::test_send_posts_to_user_and_replaces_goals -v`
Expected: FAIL with `ImportError: cannot import name 'send_suggestions'`

- [ ] **Step 3: Write minimal implementation**

In `src/energybot/billing/suggestions.py`, add:

```python
async def _send(sf, *, bill_db_id, bale) -> bool:
    from sqlalchemy import select
    from energybot.billing.repository import BillingRepository
    from energybot.profile.repository import ProfileRepository
    from energybot.core.models import User
    billing_repo = BillingRepository(session_factory=sf)
    bill = await billing_repo.get_bill_by_id(bill_db_id)
    if bill is None or bill.suggestions is None:
        return False
    s = sf()
    user = (await s.execute(select(User).where(User.id == bill.user_id))).scalar_one()
    if bale is None:
        from energybot.bale_adapter.handler import get_bale_client
        bale = get_bale_client()
    await bale.send_message(chat_id=user.bale_user_id, text=render_suggestions(bill.suggestions))
    new_goals = _build_targets_as_goals(bill.suggestions.get("targets", []), str(bill.id))
    await ProfileRepository(session_factory=sf).replace_bill_goals(bill.user_id, str(bill.id), new_goals)
    return True


async def send_suggestions(*, bill_db_id: UUID, session_factory=None, bale=None) -> bool:
    if session_factory is not None:
        return await _send(session_factory, bill_db_id=bill_db_id, bale=bale)
    from energybot.core.db import get_sessionmaker
    Session = get_sessionmaker()
    async with Session() as session:
        return await _send(lambda: session, bill_db_id=bill_db_id, bale=bale)
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest tests/integration/test_bill_suggestions.py -v`
Expected: PASS (both new send tests + all prior tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/billing/suggestions.py tests/integration/test_bill_suggestions.py
git commit -m "feat(suggestions): send_suggestions posts to user and replaces bill goals"
```

---

### Task 4: Admin API router (`admin_api/bills.py`)

Three admin endpoints: list a user's bills, regenerate (preview), send. Calls into the suggestion functions via the module so tests can monkeypatch them.

**Files:**
- Create: `src/energybot/admin_api/bills.py`
- Modify: `src/energybot/main.py` (import + `include_router`)
- Test: `tests/integration/test_admin_bills.py`

**Interfaces:**
- Consumes: `current_admin`, `get_session`, `BillingRepository.{recent_bills,get_bill_by_id}`, `suggestions.regenerate_suggestions` (Task 2), `suggestions.send_suggestions` (Task 3), models `User`, `AuditLog`.
- Produces routes (all under `/api/admin`):
  - `GET  /users/{user_id}/bills` → `{"bills": [...]}`
  - `POST /users/{user_id}/bills/{bill_id}/suggestions/regenerate` → `{"suggestions": <payload>}`
  - `POST /users/{user_id}/bills/{bill_id}/suggestions/send` → `{"ok": true}`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_admin_bills.py`:

```python
import os
import pytest
from uuid import uuid4
from httpx import ASGITransport, AsyncClient
from energybot.core.models import AdminUser, User, UtilitySubscription, Bill
from energybot.core.security import hash_password

TEST_DB = os.environ.get(
    "TEST_DATABASE_URL",
    "postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test",
)


async def _login(c, db_session) -> dict:
    db_session.add(AdminUser(email="a@b.c", password_hash=hash_password("pass1234"), role="admin"))
    await db_session.commit()
    r = await c.post("/api/admin/login", json={"email": "a@b.c", "password": "pass1234"})
    return {"x-csrf": r.headers.get("x-csrf")}


async def _user_with_bill(db_session, *, suggestions=None) -> tuple[User, Bill]:
    u = User(bale_user_id=int(uuid4().int % 1_000_000_000))
    db_session.add(u)
    await db_session.flush()
    sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="1177095800131")
    db_session.add(sub)
    await db_session.flush()
    b = Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
             amount=2_000_000, term="1405/2", details={"tariff": "خانگی"}, suggestions=suggestions)
    db_session.add(b)
    await db_session.commit()
    return u, b


@pytest.fixture
async def app(monkeypatch, db_session):
    for k, v in {"DATABASE_URL": TEST_DB, "SESSION_SECRET": "z" * 32, "BALE_WEBHOOK_SECRET": "x",
                  "BALE_BOT_TOKEN": "t", "FRONTIER_API_KEY": "f", "METIS_API_KEY": "m"}.items():
        monkeypatch.setenv(k, v)
    from energybot.settings import get_settings
    get_settings.cache_clear()
    import energybot.core.db as _db
    _db._engine = None
    _db._sessionmaker = None
    import energybot.admin_api.auth as _auth
    _auth._LOGIN_HITS.clear()
    from energybot.main import create_app
    return create_app()


@pytest.mark.asyncio
async def test_list_bills_requires_auth(app, db_session):
    u, _ = await _user_with_bill(db_session)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get(f"/api/admin/users/{u.id}/bills")
    assert r.status_code == 401


@pytest.mark.asyncio
async def test_list_bills_returns_shape(app, db_session):
    u, b = await _user_with_bill(db_session, suggestions={"intro": "hi", "tips": [], "targets": []})
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session)
        r = await c.get(f"/api/admin/users/{u.id}/bills")
    body = r.json()
    assert r.status_code == 200
    assert body["bills"][0]["id"] == str(b.id)
    assert body["bills"][0]["details"]["tariff"] == "خانگی"
    assert body["bills"][0]["suggestions"]["intro"] == "hi"


@pytest.mark.asyncio
async def test_regenerate_returns_payload(app, db_session, monkeypatch):
    u, b = await _user_with_bill(db_session)
    async def fake_regen(**kw):
        return {"intro": "تازه", "tips": [], "targets": []}
    monkeypatch.setattr("energybot.billing.suggestions.regenerate_suggestions", fake_regen)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/regenerate", headers=hdr)
    assert r.status_code == 200
    assert r.json()["suggestions"]["intro"] == "تازه"


@pytest.mark.asyncio
async def test_regenerate_rejects_foreign_bill(app, db_session, monkeypatch):
    u1, _ = await _user_with_bill(db_session)
    u2, b2 = await _user_with_bill(db_session)
    async def fake_regen(**kw):
        return {"intro": "x", "tips": [], "targets": []}
    monkeypatch.setattr("energybot.billing.suggestions.regenerate_suggestions", fake_regen)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        # bill b2 belongs to u2, not u1 -> 404
        r = await c.post(f"/api/admin/users/{u1.id}/bills/{b2.id}/suggestions/regenerate", headers=hdr)
    assert r.status_code == 404


@pytest.mark.asyncio
async def test_send_ok_and_409(app, db_session, monkeypatch):
    u, b = await _user_with_bill(db_session)
    state = {"ok": True}
    async def fake_send(**kw):
        return state["ok"]
    monkeypatch.setattr("energybot.billing.suggestions.send_suggestions", fake_send)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        hdr = await _login(c, db_session)
        r1 = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/send", headers=hdr)
        state["ok"] = False
        r2 = await c.post(f"/api/admin/users/{u.id}/bills/{b.id}/suggestions/send", headers=hdr)
    assert r1.status_code == 200 and r1.json()["ok"] is True
    assert r2.status_code == 409
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/integration/test_admin_bills.py -v`
Expected: FAIL (404s/connection errors — route not registered yet)

- [ ] **Step 3: Write minimal implementation**

Create `src/energybot/admin_api/bills.py`:

```python
from typing import Any
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from energybot.admin_api.auth import current_admin
from energybot.core.db import get_session
from energybot.core.models import AdminUser, AuditLog, User
from energybot.billing.repository import BillingRepository
from energybot.billing import suggestions as suggestions_mod

router = APIRouter(prefix="/api/admin", tags=["admin-bills"])


def _bill_dict(b) -> dict[str, Any]:
    return {
        "id": str(b.id), "utility_type": b.utility_type, "amount": int(b.amount),
        "term": b.term,
        "consumption": float(b.consumption) if b.consumption is not None else None,
        "status": b.status,
        "inquired_at": b.inquired_at.isoformat() if b.inquired_at else None,
        "details": b.details or {},
        "suggestions": b.suggestions,
    }


async def _owned_bill(s: AsyncSession, user_id: UUID, bill_id: UUID):
    bill = await BillingRepository(session_factory=lambda: s).get_bill_by_id(bill_id)
    if bill is None or bill.user_id != user_id:
        raise HTTPException(404)
    return bill


@router.get("/users/{user_id}/bills")
async def list_user_bills(user_id: UUID, _: AdminUser = Depends(current_admin),
                          s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    u = (await s.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if u is None:
        raise HTTPException(404)
    bills = await BillingRepository(session_factory=lambda: s).recent_bills(user_id, limit=24)
    return {"bills": [_bill_dict(b) for b in bills]}


@router.post("/users/{user_id}/bills/{bill_id}/suggestions/regenerate")
async def regenerate_bill_suggestions(user_id: UUID, bill_id: UUID,
                                      _: AdminUser = Depends(current_admin),
                                      s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    await _owned_bill(s, user_id, bill_id)
    payload = await suggestions_mod.regenerate_suggestions(bill_db_id=bill_id, session_factory=lambda: s)
    if payload is None:
        raise HTTPException(502, detail="generation failed")
    return {"suggestions": payload}


@router.post("/users/{user_id}/bills/{bill_id}/suggestions/send")
async def send_bill_suggestions(user_id: UUID, bill_id: UUID,
                                admin: AdminUser = Depends(current_admin),
                                s: AsyncSession = Depends(get_session)) -> dict[str, Any]:
    await _owned_bill(s, user_id, bill_id)
    ok = await suggestions_mod.send_suggestions(bill_db_id=bill_id, session_factory=lambda: s)
    if not ok:
        raise HTTPException(409, detail="no suggestions to send")
    s.add(AuditLog(admin_user_id=admin.id, action="send_bill_suggestions",
                   entity_type="bill", entity_id=str(bill_id), before=None, after=None))
    await s.commit()
    return {"ok": True}
```

In `src/energybot/main.py`, add the import next to the other admin router imports:

```python
from energybot.admin_api.bills import router as admin_bills_router
```

and register it next to the other `app.include_router(admin_*_router)` calls:

```python
    app.include_router(admin_bills_router)
```

- [ ] **Step 4: Run tests to verify pass**

Run: `python -m pytest tests/integration/test_admin_bills.py -v`
Expected: PASS (all 5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/energybot/admin_api/bills.py src/energybot/main.py tests/integration/test_admin_bills.py
git commit -m "feat(admin-api): user bills list + regenerate/send suggestion endpoints"
```

---

### Task 5: Admin UI — Bills section on the user detail page

Add API client methods and a "Bills" section card to the user-detail page (consistent with the existing card layout rather than introducing tabs). Each bill shows its current suggestions with **Regenerate** (renders the returned preview in place) and **Send to user** (confirm → post) buttons.

**Files:**
- Modify: `admin_ui/src/lib/api.ts`
- Create: `admin_ui/src/app/users/[id]/BillsSection.tsx`
- Modify: `admin_ui/src/app/users/[id]/UserDetailClient.tsx`

**Interfaces:**
- Consumes: `request` helper in `api.ts`; endpoints from Task 4.
- Produces: `api.getUserBills`, `api.regenerateBillSuggestions`, `api.sendBillSuggestions`; React component `BillsSection`.

- [ ] **Step 1: Add API client methods**

In `admin_ui/src/lib/api.ts`, add these entries to the `api` object (e.g. after `getUser`):

```ts
  getUserBills: (id: string) => request<{ bills: any[] }>(`/users/${id}/bills`),
  regenerateBillSuggestions: (userId: string, billId: string) =>
    request<{ suggestions: any }>(`/users/${userId}/bills/${billId}/suggestions/regenerate`, { method: "POST" }),
  sendBillSuggestions: (userId: string, billId: string) =>
    request<{ ok: boolean }>(`/users/${userId}/bills/${billId}/suggestions/send`, { method: "POST" }),
```

- [ ] **Step 2: Create the BillsSection component**

Create `admin_ui/src/app/users/[id]/BillsSection.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { Receipt, RefreshCw, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { api } from "@/lib/api";

function Suggestions({ s }: { s: any }) {
  if (!s) return <p className="text-sm text-muted-foreground">پیشنهادی ثبت نشده.</p>;
  return (
    <div className="space-y-2 text-sm">
      {s.intro && <p className="text-foreground">{s.intro}</p>}
      {Array.isArray(s.tips) && s.tips.length > 0 && (
        <ul className="list-disc space-y-1 pr-5 text-muted-foreground">
          {s.tips.map((t: string, i: number) => <li key={i}>{t}</li>)}
        </ul>
      )}
      {Array.isArray(s.targets) && s.targets.length > 0 && (
        <ul className="space-y-1">
          {s.targets.map((t: any, i: number) => (
            <li key={i} className="rounded-md bg-muted/50 p-2 text-foreground">{t.text}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function BillsSection({ userId }: { userId: string }) {
  const [bills, setBills] = useState<any[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => { api.getUserBills(userId).then((d) => setBills(d.bills)); }, [userId]);

  async function regenerate(billId: string) {
    setBusy(billId + ":regen"); setMsg(null);
    try {
      const r = await api.regenerateBillSuggestions(userId, billId);
      setBills((prev) => prev?.map((b) => (b.id === billId ? { ...b, suggestions: r.suggestions } : b)) ?? null);
      setMsg("پیشنهادها بازتولید شد.");
    } catch (e: any) { setMsg("خطا در بازتولید: " + e.message); }
    finally { setBusy(null); }
  }

  async function send(billId: string) {
    if (!window.confirm("پیشنهادهای این قبض برای کاربر ارسال شود؟")) return;
    setBusy(billId + ":send"); setMsg(null);
    try {
      await api.sendBillSuggestions(userId, billId);
      setMsg("برای کاربر ارسال شد.");
    } catch (e: any) { setMsg("خطا در ارسال: " + e.message); }
    finally { setBusy(null); }
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-secondary" /> قبض‌ها و پیشنهادها
        </CardTitle>
        <CardDescription>
          {bills ? `${bills.length.toLocaleString("fa-IR")} قبض` : "در حال بارگذاری…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {msg && <div className="rounded-md bg-muted/60 px-3 py-2 text-sm text-foreground">{msg}</div>}
        {bills && bills.length === 0 && <EmptyState icon={Receipt} title="قبضی ثبت نشده" />}
        {bills && bills.map((b) => (
          <div key={b.id} className="space-y-3 rounded-lg border border-border p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline">{b.utility_type}</Badge>
                <span className="text-sm text-muted-foreground">دوره {b.term ?? "—"}</span>
              </div>
              <span className="font-mono text-sm tabular-nums text-foreground">
                {Number(b.amount).toLocaleString("fa-IR")} ریال
              </span>
            </div>
            <Suggestions s={b.suggestions} />
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => regenerate(b.id)}>
                <RefreshCw className={busy === b.id + ":regen" ? "animate-spin" : ""} /> بازتولید
              </Button>
              <Button size="sm" disabled={busy !== null || !b.suggestions} onClick={() => send(b.id)}>
                <Send /> ارسال برای کاربر
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 3: Render the section in UserDetailClient**

In `admin_ui/src/app/users/[id]/UserDetailClient.tsx`:

Add the import near the other local imports:

```tsx
import { BillsSection } from "./BillsSection";
```

Then, inside the `<div className="grid gap-6 lg:grid-cols-3">` block, add `<BillsSection userId={u.id} />` immediately after the closing `</Card>` of the "گفتگوهای اخیر" card (the last card in the grid, before the grid's closing `</div>`):

```tsx
        <BillsSection userId={u.id} />
      </div>
```

- [ ] **Step 4: Verify the admin UI builds**

Run: `cd admin_ui && npm run build`
Expected: build succeeds with no TypeScript errors; the `users/[id]` route compiles.

- [ ] **Step 5: Commit**

```bash
git add admin_ui/src/lib/api.ts admin_ui/src/app/users/[id]/BillsSection.tsx admin_ui/src/app/users/[id]/UserDetailClient.tsx
git commit -m "feat(admin-ui): bills section with regenerate/send on user detail page"
```

---

### Task 6: Full regression + spec verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full Python suite**

Run: `python -m pytest -q`
Expected: all pass (the 4 pre-existing `libzbar0`/`PyMuPDF` skips are fine).

- [ ] **Step 2: Manual smoke (optional, if a dev server is handy)**

With the app running and an admin logged into the admin UI: open a user with at least one bill, confirm the "قبض‌ها و پیشنهادها" section lists bills, click **بازتولید** (preview updates in place), then **ارسال برای کاربر** (confirm dialog → success message). Confirm the user receives the message in Bale and their goals reflect the new targets.

- [ ] **Step 3: Commit (if any verification fixups were needed)**

```bash
git add -A && git commit -m "test: full regression for admin bill viewer + suggestions"
```

---

## Self-Review notes

- **Spec coverage:** §1 suggestions refactor → Tasks 2–3; §2 goal replacement → Task 1; §3 admin API → Task 4; §4 admin UI → Task 5; §5 error handling (502 regen / 409 send / post-before-goals) → Tasks 3–4; §6 testing → Tasks 1–4, 6.
- **Deviations from spec (intentional):** (a) `replace_bill_goals` lives in `ProfileRepository`, not `BillingRepository`, because that class owns goal mutation — cleaner cohesion. (b) The admin UI uses a full-width **section card** rather than a Tabs control, matching the existing user-detail layout (which is a card grid, not tabbed).
- **Type consistency:** `regenerate_suggestions`/`send_suggestions` signatures match between Tasks 2–3 (definition) and Task 4 (call via `suggestions_mod.*`); `replace_bill_goals(user_id, bill_id: str, new_goals)` matches between Task 1 (definition) and Task 3 (call with `str(bill.id)`).
