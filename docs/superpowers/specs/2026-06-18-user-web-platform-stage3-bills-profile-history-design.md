# User Web Platform — Stage 3 (Bills, Profile, History) Design

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan
**Parent spec:** `2026-06-18-user-web-platform-design.md` (§5, §7)
**Builds on:** Stage 1 (auth), Stage 2 (unified chat), both merged 2026-06-18

## 1. Summary

Stage 3 adds the three remaining authenticated screens of the user web
platform — **Bills**, **Profile**, and the read-only **History browser** —
each reusing existing backend services through new `/api/app/*` endpoints and a
new `app_ui` screen. No new business logic: the billing, profile, and chat
services already exist and are shared with the Bale bot. Edits made on the web
(profile changes, bill inquiries/payments) are immediately visible to the bot
because both operate on the same data.

## 2. Goals & non-goals

**Goals:**
- **Bills** (`/app/bills`): subscriptions, bill history, consumption trend
  chart, inquire a bill by id, and pay via the existing gateway redirect.
- **Profile** (`/app/profile`): view + edit the structured household form
  (wizard option sets), manage goals/commitments, read-only behaviour, show
  completeness.
- **History** (`/app/history`): read-only browser of past chat sessions and
  their transcripts.

**Non-goals (deferred):**
- New payment providers or changing the gateway/callback flow (web reuses it).
- Editing `behaviour` on web (agent-managed; read-only).
- Jalali date library (use the browser's `Intl` Persian calendar for display).
- Dashboard (Stage 4).

## 3. Architecture

All endpoints live under `/api/app/*`, gated by `current_user`, and use the
Stage-2 scoped-session pattern: `Session = get_sessionmaker(); async with
Session() as session: session_factory = lambda: session`. No endpoint persists
outside the services it calls.

```
/app/bills    → GET/POST /api/app/bills*    → billing factory + BillingService/Repository
/app/profile  → GET/PATCH/POST/DELETE /api/app/profile* → ProfileRepository + wizard.STEPS schema
/app/history  → GET /api/app/chat/sessions* → ChatRepository
```

## 4. Backend: reuse-enabling additions

### 4.1 `billing/factory.py` (new) — extracted from the Bale handler

Move `build_billing_service(session_factory) -> BillingService` out of
`bale_adapter/handler.py` into `src/energybot/billing/factory.py`. The handler
imports it back (thin change, behavior-preserving — existing bill tests must
pass). Web builds the same service via this factory.

### 4.2 `BillingRepository.list_subscriptions(user_id) -> list[UtilitySubscription]`

Active (non-deleted) subscriptions for a user, newest first.

### 4.3 `ChatRepository` additions

- `list_sessions(user_id) -> list[dict]`: per session `{id, started_at,
  ended_at, message_count, snippet}` where `snippet` is the first user
  message's content (truncated ~80 chars), newest first.
- `session_messages(user_id, session_id) -> list[Message]`: that session's
  `user`/`assistant` messages (non-deleted), oldest-first, scoped to the user
  (404 if the session is not theirs).

### 4.4 `ProfileRepository.remove_item(user_id, section, index)`

Remove an item from `goals`/`commitments` by index, recompute completeness,
record a `ProfileEvent` (`field_path=f"{section}[-{index}]"`, `source="web"`).
Out-of-range index raises `IndexError` (endpoint → 404).

### 4.5 Household field schema from `wizard.STEPS`

The household form is driven by the wizard's canonical step definitions
(`profile/wizard.py:STEPS`). A small helper exposes, per household field:
`{key, label (prompt), options (buttons or null), path}`. The profile endpoints
import `STEPS`; PATCH validates select fields against their `options` and stores
the value (occupants via the wizard's int normalizer; others as the option
string). This keeps web and bot consistent from one source of truth.

## 5. Endpoints

### 5.1 Bills (`src/energybot/user_api/bills.py`)

- `GET /api/app/bills` → `{subscriptions: [{id, utility_type, bill_id, label}],
  bills: [{id, utility_type, amount, term, consumption, due_date, status,
  inquired_at}]}` (recent bills via `recent_bills`, subs via
  `list_subscriptions`).
- `POST /api/app/bills/inquire {bill_id}` → reuses `BillingService.handle_input(
  user_id, text=bill_id)`; returns `{ok, summary, bill_db_id, error}`.
- `POST /api/app/bills/{bill_db_id}/pay` → reuses
  `BillingService.start_payment(user_id, chat_id=user.bale_user_id, bill_db_id)`;
  returns `{url}`. Errors → 400 with a Persian message.

### 5.2 Profile (`src/energybot/user_api/profile.py`)

- `GET /api/app/profile` → `{household, behaviour, goals, commitments,
  completeness_score, fields: [{key, label, options, path}]}`.
- `PATCH /api/app/profile {path, value}` → validates `path` is a known household
  field and (for select fields) `value` ∈ options; applies normalizer; calls
  `ProfileRepository.set(..., source="web", reason="web edit")`. Invalid → 422.
  Returns the updated profile.
- `POST /api/app/profile/goals {text}` and `.../commitments {text}` → append.
- `DELETE /api/app/profile/goals/{index}` and `.../commitments/{index}` →
  remove. All mutations return the updated profile (so completeness/indices
  stay in sync).

### 5.3 History (extend `src/energybot/user_api/chat.py`)

- `GET /api/app/chat/sessions` → `[{id, started_at, ended_at, message_count,
  snippet}]`, newest first.
- `GET /api/app/chat/sessions/{session_id}` → `{messages: [{id, role, content,
  created_at}]}` for that session (user/assistant only); 404 if not the user's.

## 6. Frontend screens (`app_ui`)

All use `AppShell`, RTL, the existing design language. The Sidebar already links
to all three routes.

### 6.1 `/app/bills`
Subscriptions list; bill-history table (term, amount in toman with thousands
separators, consumption, due date, status, newest first); consumption trend
chart (Recharts, newly added to `app_ui`; table-only fallback when too few
points); inquire input → summary + پرداخت button; پرداخت opens the gateway `url`
in a new tab with a note that a bot confirmation follows. Empty state when no
subscriptions/bills.

### 6.2 `/app/profile`
Completeness meter; household form (text for `city`, selects with wizard option
labels for the rest) saving each field on change via `PATCH` with optimistic
UI + revert-on-error; goals & commitments as removable chips with an add input;
read-only behaviour section labeled as learned from chats. Empty states.

### 6.3 `/app/history`
Session list (start date via `Intl` Persian calendar, snippet, message count,
newest first); transcript view of the selected session as read-only bubbles
(same styling as chat, no composer, tool rows excluded). Selected session in a
query param `/app/history?s=<id>` (static-export friendly). List/transcript
side-by-side on wide screens; tap-through + back on narrow. Empty state.

### 6.4 Charts
Add a lightweight chart lib (Recharts) scoped to `app_ui` for the bills trend.

## 7. Error handling

- Inquiry surfaces the existing Persian `CaptureResult.error` (bad id /
  Finnotech down).
- Pay failure → 400 + friendly Persian message, no redirect.
- Invalid profile value → 422; frontend reverts the optimistic change.
- All endpoints `current_user`-gated; AppShell redirects to `/app/auth` on 401.

## 8. Testing

- **`billing/factory` extraction:** Bale handler still builds its service;
  existing bill tests pass.
- **Repo additions:** `list_subscriptions`; `list_sessions` (snippet + count);
  `session_messages` (session-scoped, tool rows excluded, user ownership);
  `ProfileRepository.remove_item` (+ completeness recompute).
- **Bills endpoints:** `GET /bills` shape; `POST /inquire` with a faked billing
  service (`ok`/`error`); `POST /{id}/pay` with a faked payment provider →
  `{url}`, asserting `chat_id == bale_user_id`.
- **Profile endpoints:** `GET /profile` (incl. schema from `wizard.STEPS`);
  `PATCH` records `ProfileEvent(source="web")` and rejects an invalid select
  option (422); goals/commitments add/remove with completeness recompute.
- **History endpoints:** `GET /chat/sessions` / `/{id}` shapes + auth + a
  not-your-session 404.
- **Frontend:** `npm run build` + `tsc --noEmit` + in-process serve smoke for
  `/app/bills`, `/app/profile`, `/app/history`.

## 9. Build order (one spec, staged, each independently shippable)

1. Backend reuse layer: `billing/factory.py` extraction + `list_subscriptions` +
   `list_sessions`/`session_messages` + `ProfileRepository.remove_item` +
   household schema helper (with tests).
2. Bills endpoints (`user_api/bills.py`) + router wiring.
3. Profile endpoints (`user_api/profile.py`) + router wiring.
4. History endpoints (extend `chat.py`).
5. Frontend `/app/bills` (+ Recharts).
6. Frontend `/app/profile`.
7. Frontend `/app/history`.

## 10. Open items / future (post-Stage-3)
- Dashboard aggregate + screen (Stage 4).
- Carryover deferrals from Stages 1–2 (lazy `last_seen_at`; true token
  streaming; historical KB media; `done.message_id` exact id; stable bubble
  keys; deleted-attachment 404 test).
