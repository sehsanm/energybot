# Energybot — User Web Platform Design

**Date:** 2026-06-18
**Status:** Approved design, pending implementation plan
**Related:** `2026-05-21-energybot-phase1-design.md`, `2026-06-17-energybot-bill-pay-analysis-design.md`

## 1. Summary

A user-facing web platform that lets Energybot users log in with their existing
Bale identity (no new password) and get **everything the Bale bot offers, plus
more**: an AI chat that shares one continuous conversation with the bot, bill
inquiry/payment and history, a profile editor, browsable chat history, and an
app-like dashboard.

The platform is a **new user-facing API surface (`/api/app/*`) plus a new
Next.js static-export frontend (`app_ui`)** that reuse the existing agent,
profile, billing, KB, and chat services. It follows the project's established
stack decisions: Python + FastAPI + Postgres, Next.js static export served by
FastAPI, single container, Iran VPS, Persian-only.

The Bale bot's behavior is unchanged by this work.

## 2. Goals & non-goals

**Goals (v1):**
- Bale-initiated magic-link login → web session.
- AI chat unified with the bot (shared thread, history, and memory).
- Bills & history: subscriptions, inquiry, payment, consumption trend.
- Profile view/edit.
- Browsable chat history (Bale + web).
- App-like dashboard with a sidebar layout.

**Non-goals (v1):**
- True provider-level token streaming (pseudo-streaming ships first; see §6).
- Email/password or OTP login (Bale deep-link only).
- Multi-language (Persian-only, RTL).
- New analytics beyond what existing services expose.

## 3. Architecture overview

```
Bale bot ──(/web button → deep-link token)──► browser
                                                  │
                                  app_ui (Next.js static export @ /app)
                                                  │  fetch + CSRF
                                                  ▼
                              FastAPI  /api/app/*  (current_user gate)
                                                  │
        ┌──────────────┬───────────────┬──────────┴───────┬──────────────┐
        ▼              ▼               ▼                  ▼              ▼
   AgentLoop      ProfileRepo      billing svc        ChatRepository   KB
 (ResponseChannel) (ProfileEvent)  (Finnotech/pay)    (history)
```

Everything runs in the existing single container. `main.py` mounts a third
static app at `/app` (alongside `/admin` and `/`).

## 4. Authentication & sessions

### 4.1 Deep-link login flow (Bale-initiated)

1. In the bot, the user taps a **"🌐 ورود به نسخهٔ وب"** inline button (also a
   `/web` command). The Bale handler mints a one-time login token.
2. Bot DMs a URL button: `https://<host>/app/auth?t=<token>`. Token is random,
   short-TTL (~5 min), single-use.
3. Tapping opens `app_ui` at `/app/auth`, which calls
   `POST /api/app/auth/redeem { t }`.
4. Backend validates the token (exists, unexpired, unused), marks it used,
   creates a `UserSession`, sets an httpOnly `energybot_user` cookie, and
   returns `{ user, csrf }`.
5. Frontend redirects to `/app` (dashboard), authenticated.

### 4.2 New tables (Alembic migration)

`web_login_tokens`
- `token_hash` (String PK) — hashed token, never store raw
- `user_id` (FK users.id, ON DELETE CASCADE)
- `expires_at` (datetime)
- `used_at` (datetime, nullable)
- `created_at` (server default now)

`user_sessions`
- `id` (String PK) — hashed cookie value (`session_id_for`)
- `user_id` (FK users.id, ON DELETE CASCADE)
- `issued_at`, `last_seen_at`, `expires_at` (~30 days, sliding)

### 4.3 Security

- Reuse `core/security.py`: `new_session_token`, `session_id_for`, `sign_csrf`.
- Cookie: `httpOnly`, `Secure`, `SameSite=Lax`, path `/`.
- CSRF token echoed in `x-csrf` response header; required on mutating requests
  (POST/PUT/PATCH/DELETE) — identical to admin auth.
- Rate-limit `redeem` and the `/web` mint (per-IP / per-user window, like the
  admin login limiter).
- Tokens are single-use and burned on first redeem; the leak window is one
  short-lived unused token.
- A `current_user` FastAPI dependency (parallel to `current_admin`) gates every
  `/api/app/*` route and rejects blocked (`is_blocked`) or deleted
  (`deleted_at`) users.

## 5. Backend API (`/api/app/*`)

All routes gated by `current_user` except `auth/redeem`.

| Method & path | Purpose |
| --- | --- |
| `POST /auth/redeem` | Exchange login token for a session cookie |
| `POST /auth/logout` | Invalidate the session |
| `GET /me` | Current user summary |
| `POST /chat` | Send a message; returns an **SSE stream** of the reply |
| `GET /chat/history?before=…` | Paginated past messages (Bale + web) |
| `GET /chat/sessions` | Session list for the history browser |
| `GET /profile` | Profile (household/behaviour/goals/commitments) |
| `PATCH /profile` | Edit profile; records `ProfileEvent(source="web")` |
| `GET /subscriptions` | Utility subscriptions |
| `GET /bills` | Bill history + consumption trend |
| `POST /bills/inquire` | Inquire a bill by id |
| `POST /bills/{id}/pay` | Start payment; returns gateway redirect URL |
| `GET /dashboard` | Aggregate for the dashboard landing |

Profile/bills endpoints reuse `ProfileRepository` and the `billing` service
directly — no business-logic duplication. `/dashboard` is a thin aggregate over
the same services (latest bill, consumption snapshot, completeness score, last
assistant message, recent activity).

## 6. Unified chat

### 6.1 Channel abstraction

Today `AgentLoop.handle_message` returns the final text, and the only
channel-coupled chat tool is `send_kb_media`, which pushes media straight to a
Bale `chat_id`. Billing/payment and the onboarding wizard live in the Bale
**handler**, not in the agent, so on web they are plain REST endpoints — not
chat tools.

Introduce a small `ResponseChannel` interface with two implementations:
- `BaleChannel` — wraps `BaleClient` + `chat_id`; reproduces today's behavior
  exactly (regression-guarded by tests).
- `WebChannel` — buffers structured events (e.g. `{type: "media", ...}`) for the
  SSE endpoint to emit.

`send_kb_media` calls `channel.send_media(...)` instead of touching `bale`
directly. The agent loop and Bale handler are otherwise unchanged.

Chat data is already unified: `messages` and `chat_sessions` are keyed by
`user_id`, not by channel, so a message sent in Bale appears in web history and
vice-versa, and the agent has full cross-channel context.

### 6.2 Streaming (pseudo-streaming for v1)

Providers have **no streaming** today (`Provider.chat()` returns a full
response). v1 ships **pseudo-streaming**: the agent computes the full reply
server-side (reusing `handle_message` unchanged), and `POST /chat` emits it over
SSE as:

```
event: status   data: {"text": "در حال جستجوی منابع…"}   # during tool calls
event: chunk    data: {"text": "<partial>"}              # repeated
event: done     data: {"message_id": …}
event: error    data: {"text": "متأسفم، یه مشکل فنی…"}    # on failure
```

This yields the ChatGPT-style typewriter effect; only first-token latency
differs from true streaming. The SSE event contract is stable, so a later
upgrade to true streaming (add `chat_stream` to the `Provider` protocol + the
three providers + router) is invisible to the frontend.

## 7. Frontend (`app_ui`)

New Next.js static-export app mounted at `/app`, same toolchain and component
library as `admin_ui` (React + Tailwind + shadcn-style `ui/` primitives,
`AppShell` + `Sidebar` + `Topbar`, `ThemeToggle`, `lib/api.ts` with CSRF).
Persian/RTL, **app-like layout**: a persistent **right-side sidebar** (RTL) that
collapses to a drawer on narrow screens so it still works for phone users.

**Layout:** `Sidebar` (داشبورد · گفتگو · قبض‌ها · تاریخچه · پروفایل) +
`Topbar` (display name, theme toggle, خروج) + content area.

**Screens / routes:**
- `/app/auth` — redeems `?t=` token → dashboard; friendly errors on
  expired/used token ("برگرد به بله و دوباره وارد شو").
- `/app` — **Dashboard** (landing): cards for latest bill (amount/due), a small
  consumption trend chart, profile-completeness meter, "ادامهٔ گفتگو" (last
  assistant message), recent activity. Backed by `GET /api/app/dashboard`.
- `/app/chat` — full chat: streaming typewriter, KB media rendering, composer,
  status indicator.
- `/app/bills` — subscriptions, bill history, consumption trend chart,
  استعلام جدید, per-bill پرداخت (gateway redirect).
- `/app/history` — read-only browsable past sessions/transcripts (Bale + web).
- `/app/profile` — view/edit household / behaviour / goals / commitments.

**Static serving:** IDs are passed as query strings (e.g. `/app/bills?sub=…`) so
all routes are static paths → a plain `StaticFiles(html=True)` mount at `/app`,
avoiding the dynamic-segment placeholder logic `admin_ui` needs. New env var
`ENERGYBOT_APP_STATIC_DIR` (default `app_ui/out`).

**Charts:** add a lightweight chart lib (e.g. Recharts) scoped to `app_ui` for
the dashboard and bills trend.

## 8. Error handling

- Token redeem failures → clear Persian message + "return to Bale" CTA, never a
  raw 401 page.
- Chat SSE: on agent exception, emit an `error` event with the same friendly
  fallback the bot uses, then close the stream cleanly.
- Payment redirect failures reuse the existing billing error paths.

## 9. Testing

Follows existing `pytest` patterns (unit + Postgres integration).

- **Auth:** token mint, redeem happy-path, expired token, already-used token,
  blocked/deleted-user rejection, cookie + CSRF enforcement on mutating routes.
- **Channel abstraction:** `BaleChannel` reproduces today's Bale calls
  (regression guard); `WebChannel` buffers the right events; `send_kb_media`
  works through both.
- **API:** `PATCH /profile` records `ProfileEvent(source="web")`; `/bills`
  reuses billing service; `/dashboard` aggregate shape; `/chat` SSE emits
  `status → chunk* → done` in order, `error` on failure.
- **Bot:** `/web` command / inline button mints a token and sends the deep-link
  button.
- **Frontend:** matches `admin_ui` convention (no FE unit tests there today);
  manual verification + optional Playwright smoke of login→chat.

## 10. Build order (staged, each stage shippable)

1. **Auth foundation** — tokens + sessions + `current_user` + `/web` bot entry
   + `app_ui` shell (sidebar/topbar, auth screen).
2. **Unified chat** — `ResponseChannel` abstraction + `/chat` SSE + history
   endpoints + chat screen.
3. **Bills + Profile** — screens and endpoints (reusing existing services).
4. **Dashboard** — aggregate endpoint + dashboard screen.

## 11. Open items / future

- True provider-level token streaming (upgrade from pseudo-streaming).
- Richer web-native features beyond bot parity (deeper bill analytics, exports).
