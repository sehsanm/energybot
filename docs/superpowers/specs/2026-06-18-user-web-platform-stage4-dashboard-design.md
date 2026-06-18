# User Web Platform — Stage 4 (Dashboard) Design

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan
**Parent spec:** `2026-06-18-user-web-platform-design.md` (§5, §6.1)
**Builds on:** Stages 1 (auth), 2 (chat), 3 (bills/profile/history), all merged 2026-06-18

## 1. Summary

Stage 4 — the final planned screen — replaces the `/app` placeholder with a
**dashboard landing page** showing three at-a-glance cards: profile
completeness, the latest bill, and a consumption trend. It is a thin aggregate
over existing services through one new endpoint `GET /api/app/dashboard` plus a
rewrite of the dashboard page. No new business logic.

## 2. Goals & non-goals

**Goals:**
- `GET /api/app/dashboard` aggregating completeness + latest bill + trend.
- The `/app` dashboard screen with the three cards, replacing the placeholder.

**Non-goals (deferred):**
- A "continue chat" card (dropped from scope).
- A generic recent-activity feed.
- New billing/profile logic (reuse existing repos and the Stage-3 `payBill`).

## 3. Backend: `GET /api/app/dashboard`

New `src/energybot/user_api/dashboard.py`, one endpoint gated by `current_user`,
scoped-session pattern (`Session = get_sessionmaker(); async with Session() as
session: lambda: session`), wired into `main.py` after the other user-api
routers.

Response shape:

```
{
  "completeness_score": int,                 # ProfileRepository.get(user_id).completeness_score
  "latest_bill": {                           # newest of recent_bills, or null
    "id": str, "utility_type": str, "amount": int, "term": str | null,
    "due_date": ISO8601 | null, "status": str
  } | null,
  "trend": [                                 # bills with a consumption value, oldest-first
    { "term": str | null, "consumption": float, "utility_type": str }
  ]
}
```

Implementation: one `ProfileRepository.get(user_id)` and one
`BillingRepository.recent_bills(user_id, limit=24)`. `latest_bill` is the first
(newest) bill or `null`; `trend` is the bills whose `consumption is not None`,
reversed to oldest-first. Amounts stay raw rial (the frontend converts to
toman). No persistence, no external calls.

## 4. Frontend: `/app` dashboard

Replace `app_ui/src/app/page.tsx` (the Stage-1 placeholder) with the dashboard.
Uses `AppShell`, RTL, the existing design language. New `getDashboard()` in
`app_ui/src/lib/api.ts`; reuse the Stage-3 `payBill` and the `toman`/Recharts
helpers.

Cards:
1. **Profile completeness** — a 0–100 meter; below 100, a "تکمیل پروفایل" link
   to `/app/profile`.
2. **Latest bill** — amount (toman), term, due date, status, and a پرداخت
   button → `payBill(latest_bill.id)` → opens the gateway URL in a new tab. When
   `latest_bill` is `null`: "هنوز قبضی نداری — استعلام بزن" linking to
   `/app/bills`.
3. **Consumption trend** — a small Recharts line chart when `trend.length >= 2`;
   otherwise a short "داده کافی برای نمودار نیست" note.

The page loads `getDashboard()` on mount; a fetch failure leaves a graceful
empty state (no crash).

## 5. Error handling

- Endpoint `current_user`-gated; AppShell redirects to `/app/auth` on 401.
- Pay reuses the Stage-3 endpoint (ownership-checked); failure → no redirect.
- Frontend tolerates `latest_bill: null` and `trend: []` without crashing.

## 6. Testing

- **Backend:** `GET /dashboard` shape with a seeded profile + bills
  (completeness present; `latest_bill` = newest; `trend` only the bills with
  consumption, oldest-first); empty case (no bills → `latest_bill: null`,
  `trend: []`); unauthenticated → 401.
- **Frontend:** `npm run build` + `tsc --noEmit` + in-process serve smoke for
  `/app/` (the dashboard is the `/app` root → `out/index.html`).

## 7. Build order (2 tasks)

1. `GET /api/app/dashboard` aggregate endpoint (+ tests, router wiring).
2. `/app` dashboard screen (`getDashboard` + page rewrite, build + smoke).

## 8. Open items / future (post-Stage-4 — completes the planned platform)
- Carryover deferrals across stages: true token streaming; live per-tool status;
  historical KB media; profile `get_or_create`/404 for profile-less users;
  rate-limiting the money endpoints; lazy `last_seen_at`; frontend stable bubble
  keys + surfaced fetch errors.
