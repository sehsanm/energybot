# User Web Platform — Stage 4 (Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/app` placeholder with a dashboard landing page showing profile completeness, the latest bill, and a consumption trend, backed by one aggregate endpoint.

**Architecture:** A thin `GET /api/app/dashboard` endpoint aggregates `ProfileRepository.get().completeness_score` and `BillingRepository.recent_bills(...)`; the `/app` screen renders three cards reusing the Stage-3 `payBill`/`toman`/Recharts. No new business logic.

**Tech Stack:** Python + FastAPI + SQLAlchemy async + Postgres; Next.js static export + React + Recharts; pytest integration.

## Global Constraints

- Persian-only (`fa`), RTL frontend.
- New endpoint under `/api/app/*`, gated by `current_user`, scoped-session pattern: `Session = get_sessionmaker(); async with Session() as session: sf = lambda: session`. Do NOT pass the bare `get_sessionmaker()` as a session_factory.
- No new business logic; reuse existing repos + the Stage-3 `payBill` (ownership-checked) endpoint.
- Amounts stay raw rial in the API; the frontend converts to toman (`rial // 10`) with thousands separators.
- venv `.venv/`; test Postgres `postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test` (`TEST_DATABASE_URL`; `docker compose -f docker-compose.test.yml up -d`).

**Reference spec:** `docs/superpowers/specs/2026-06-18-user-web-platform-stage4-dashboard-design.md`

---

## File Structure

- `src/energybot/user_api/dashboard.py` — the aggregate endpoint (create).
- `src/energybot/main.py` — include the dashboard router (modify).
- `app_ui/src/lib/api.ts` — `getDashboard` (modify).
- `app_ui/src/app/page.tsx` — replace the placeholder with the dashboard (modify).
- Test: `tests/integration/test_user_dashboard.py` (create).

---

### Task 1: `GET /api/app/dashboard` aggregate endpoint

**Files:**
- Create: `src/energybot/user_api/dashboard.py`
- Modify: `src/energybot/main.py`
- Test: `tests/integration/test_user_dashboard.py`

**Interfaces:**
- Consumes: `current_user`, `get_sessionmaker`, `ProfileRepository.get`, `BillingRepository.recent_bills`.
- Produces: `GET /api/app/dashboard` → `{completeness_score: int, latest_bill: {id,utility_type,amount,term,due_date,status}|null, trend: [{term,consumption,utility_type}]}`.

- [ ] **Step 1: Write the failing tests**

Create `tests/integration/test_user_dashboard.py`:

```python
import os
from datetime import datetime, timedelta
import pytest
from httpx import ASGITransport, AsyncClient
from energybot.core.models import User, Profile, UtilitySubscription, Bill
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
    return u


@pytest.mark.asyncio
async def test_dashboard_aggregates_profile_and_bills(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        u = await _login(c, db_session, 1001001)
        sub = UtilitySubscription(user_id=u.id, utility_type="electricity", bill_id="111")
        db_session.add(sub)
        await db_session.flush()
        now = datetime.utcnow()
        # older bill, with consumption
        db_session.add(Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                            amount=120000, term="1401", consumption=210, inquired_at=now - timedelta(days=2)))
        # newest bill, no consumption value
        db_session.add(Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                            amount=150000, term="1402", consumption=None, inquired_at=now))
        # middle bill, with consumption
        db_session.add(Bill(user_id=u.id, subscription_id=sub.id, utility_type="electricity",
                            amount=130000, term="1402-spring", consumption=180, inquired_at=now - timedelta(days=1)))
        await db_session.commit()
        r = await c.get("/api/app/dashboard")
    assert r.status_code == 200
    body = r.json()
    assert body["completeness_score"] == 0
    assert body["latest_bill"]["term"] == "1402"          # newest by inquired_at
    assert body["latest_bill"]["amount"] == 150000
    # trend: only bills with consumption, oldest-first
    assert [t["consumption"] for t in body["trend"]] == [210, 180]


@pytest.mark.asyncio
async def test_dashboard_empty_when_no_bills(app, db_session):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        await _login(c, db_session, 1002002)
        r = await c.get("/api/app/dashboard")
    assert r.status_code == 200
    body = r.json()
    assert body["latest_bill"] is None
    assert body["trend"] == []


@pytest.mark.asyncio
async def test_dashboard_requires_auth(app):
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t") as c:
        r = await c.get("/api/app/dashboard")
    assert r.status_code == 401
```

- [ ] **Step 2: Run to verify failure**

Run: `TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_dashboard.py -v`
Expected: FAIL (no `/api/app/dashboard` route → 404/401 mismatch, or import error).

- [ ] **Step 3: Create the dashboard router**

Create `src/energybot/user_api/dashboard.py`:

```python
from fastapi import APIRouter, Depends
from energybot.core.db import get_sessionmaker
from energybot.core.models import User
from energybot.user_api.auth import current_user
from energybot.profile.repository import ProfileRepository
from energybot.billing.repository import BillingRepository

router = APIRouter(prefix="/api/app", tags=["app"])


def _bill_brief(b) -> dict:
    return {
        "id": str(b.id), "utility_type": b.utility_type, "amount": int(b.amount),
        "term": b.term, "due_date": b.due_date.isoformat() if b.due_date else None,
        "status": b.status,
    }


@router.get("/dashboard")
async def dashboard(user: User = Depends(current_user)):
    Session = get_sessionmaker()
    async with Session() as session:
        sf = lambda: session
        profile = await ProfileRepository(session_factory=sf).get(user.id)
        bills = await BillingRepository(session_factory=sf).recent_bills(user.id, limit=24)
        with_consumption = [b for b in bills if b.consumption is not None]
        trend = [
            {"term": b.term, "consumption": float(b.consumption), "utility_type": b.utility_type}
            for b in reversed(with_consumption)
        ]
        return {
            "completeness_score": profile.completeness_score,
            "latest_bill": _bill_brief(bills[0]) if bills else None,
            "trend": trend,
        }
```

> `recent_bills` returns bills newest-first (the Stage-3 bills screen reverses them for its chart), so `bills[0]` is the latest and `reversed(with_consumption)` is oldest-first.

- [ ] **Step 4: Wire the router**

In `src/energybot/main.py`: add `from energybot.user_api.dashboard import router as user_dashboard_router` near the other user-api imports, and `app.include_router(user_dashboard_router)` right after `app.include_router(user_profile_router)`.

- [ ] **Step 5: Run the tests + full suite**

Run:
```bash
TEST_DATABASE_URL=postgresql+asyncpg://energybot:energybot@localhost:5433/energybot_test .venv/bin/pytest tests/integration/test_user_dashboard.py -v
.venv/bin/pytest -m "not llm" -q
```
Expected: 3 dashboard tests pass; full suite green.

- [ ] **Step 6: Commit**

```bash
git add src/energybot/user_api/dashboard.py src/energybot/main.py tests/integration/test_user_dashboard.py
git commit -m "feat(user-web): GET /api/app/dashboard aggregate endpoint"
```

---

### Task 2: `/app` dashboard screen

**Files:**
- Modify: `app_ui/src/lib/api.ts` (`getDashboard`)
- Modify: `app_ui/src/app/page.tsx` (replace placeholder with the dashboard)

**Interfaces:** consumes `GET /dashboard`; reuses `payBill` (Stage 3).

> No FE unit tests in this repo. Verification = `npx tsc --noEmit` (exit 0) + `npm run build` + the in-process serve smoke for `/app/`.

- [ ] **Step 1: Add the dashboard API client function**

Append to `app_ui/src/lib/api.ts`:

```ts
export type DashboardData = {
  completeness_score: number;
  latest_bill: { id: string; utility_type: string; amount: number; term: string | null; due_date: string | null; status: string } | null;
  trend: { term: string | null; consumption: number; utility_type: string }[];
};

export async function getDashboard(): Promise<DashboardData> {
  const r = await req("/dashboard");
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
}
```

- [ ] **Step 2: Replace the dashboard page**

Replace the entire contents of `app_ui/src/app/page.tsx` with:

```tsx
"use client";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getDashboard, payBill, type DashboardData } from "@/lib/api";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const UTIL = (t: string) => (t === "electricity" ? "برق" : t === "gas" ? "گاز" : "قبض");
const toman = (rial: number) => `${Math.floor(rial / 10).toLocaleString("fa-IR")} تومان`;

export default function DashboardPage() {
  const [d, setD] = useState<DashboardData | null>(null);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { getDashboard().then(setD).catch(() => {}).finally(() => setLoaded(true)); }, []);

  return (
    <AppShell>
      <div dir="rtl" className="space-y-6">
        <h1 className="text-lg font-semibold">داشبورد</h1>
        {!loaded ? (
          <p className="text-sm text-muted-foreground">در حال بارگذاری…</p>
        ) : !d ? (
          <p className="text-sm text-muted-foreground">بارگذاری اطلاعات ناموفق بود.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <section className="rounded-lg border p-4">
              <h2 className="mb-2 text-sm font-medium">تکمیل پروفایل</h2>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground"><span>وضعیت</span><span>{d.completeness_score}٪</span></div>
              <div className="h-2 w-full rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${d.completeness_score}%` }} /></div>
              {d.completeness_score < 100 && <a href="/app/profile" className="mt-2 inline-block text-xs text-primary hover:underline">تکمیل پروفایل</a>}
            </section>

            <section className="rounded-lg border p-4">
              <h2 className="mb-2 text-sm font-medium">آخرین قبض</h2>
              {d.latest_bill ? (
                <div className="space-y-1 text-sm">
                  <div>{UTIL(d.latest_bill.utility_type)} — {toman(d.latest_bill.amount)}</div>
                  {d.latest_bill.term && <div className="text-muted-foreground">دوره: {d.latest_bill.term}</div>}
                  {d.latest_bill.due_date && <div className="text-muted-foreground">مهلت: {d.latest_bill.due_date}</div>}
                  <button
                    onClick={() => { const id = d.latest_bill!.id; payBill(id).then((u) => window.open(u, "_blank")).catch(() => {}); }}
                    className="mt-2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">پرداخت 💳</button>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">هنوز قبضی نداری — <a href="/app/bills" className="text-primary hover:underline">استعلام بزن</a></p>
              )}
            </section>

            <section className="rounded-lg border p-4 sm:col-span-2">
              <h2 className="mb-2 text-sm font-medium">روند مصرف</h2>
              {d.trend.length >= 2 ? (
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <LineChart data={d.trend}><XAxis dataKey="term" /><YAxis /><Tooltip /><Line type="monotone" dataKey="consumption" /></LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">داده کافی برای نمودار نیست.</p>
              )}
            </section>
          </div>
        )}
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 3: Build + typecheck + smoke**

Run:
```bash
cd app_ui && npx tsc --noEmit && npm run build && cd ..
ls app_ui/out/index.html
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
        r = await c.get("/app/")
        assert r.status_code == 200 and "html" in r.headers.get("content-type","")
    print("SMOKE OK")
asyncio.run(main())
PY
```
Expected: `tsc` exit 0, build ok, `out/index.html` exists, `SMOKE OK`. (Ignore any editor "cannot find module react" diagnostics — `tsc`/build are the source of truth.)

- [ ] **Step 4: Commit**

```bash
git add app_ui/src/lib/api.ts app_ui/src/app/page.tsx
git commit -m "feat(app_ui): /app dashboard (completeness, latest bill, consumption trend)"
```

---

## Self-Review

**Spec coverage:**
- §3 aggregate endpoint (completeness + latest_bill + trend, scoped session, gated) → Task 1. ✓
- §4 dashboard screen (3 cards, payBill, empty states) → Task 2. ✓
- §5 error handling (401 gate, pay reuse, null/empty tolerance) → Task 1 (401) + Task 2 (null/empty + pay). ✓
- §6 testing (shape, empty, 401; FE build+smoke) → Task 1 tests + Task 2 verification. ✓
- §7 build order (2 tasks) → matches. ✓

**Placeholder scan:** No "TBD"/"similar to"/"add error handling". The `>` notes are concrete facts (recent_bills ordering; tsc/build authority).

**Type consistency:** `getDashboard()` return type matches the endpoint shape (`completeness_score`, `latest_bill{id,utility_type,amount,term,due_date,status}|null`, `trend[{term,consumption,utility_type}]`) across Task 1 and Task 2. `payBill(id)` reused from Stage 3 with its existing signature. `toman = rial//10` matches the backend rial convention. Test uses explicit `inquired_at` values so "newest" is deterministic (avoids the same-transaction `server_default=now()` tie observed in Stage 3 Task 1).

## Notes for later (not part of this plan)
- This completes the planned web platform surface (Stages 1–4).
- Carryover deferrals: profile `get_or_create`/404 for profile-less users; rate-limiting money endpoints; true token streaming; historical KB media; stable bubble keys; surfaced frontend fetch errors.
