# Design: Mini-App Foundation & Dual-Channel Shell (Sub-project 0)

**Date:** 2026-10-01
**Status:** Approved (design); ready for implementation plan
**Owner:** Sehsanm

---

## 0. Program context — the refurbish roadmap

Energybot is being refurbished from a Bale-only assistant into a multi-aspect,
gamified energy-saving platform delivered as a mini app inside both **Bale** and
**Telegram**. The program decomposes into six sub-projects, each with its own
spec → plan → build cycle:

| # | Sub-project | Status |
|---|---|---|
| 0 | **Mini-app foundation & dual-channel shell** (this spec) | this document |
| 1 | Gamification core (XP, streaks, levels, badges, coin ledger → ties into incentives money-back) | pending |
| 2 | Mini courses (Duolingo-style lessons, MCQ, simulators, Gemini TTS voice, AI content pipeline) | pending |
| 3 | Bill photo upload + insights (OCR → existing bill pipeline) | pending |
| 4 | Nudge engine (AI-driven; memory + weather + news; via bot + mini app) | pending |
| 5 | SEO website (public content site fed from KB + course catalog) | pending |

Admin-console extensions are woven into each sub-project rather than being a
separate phase. UX for existing (built) surfaces is redesigned with **Stitch**
as part of sub-project 0, and every later feature inherits that design system.

**What already exists** (context for this spec): Bale bot with onboarding flow,
home menu, commands, multiselect widgets; agent loop with 12 tools; Persian KB
with hybrid retrieval; user memory & profile; billing via Finnotech with bill
suggestions; incentives data layer; user web app (`app_ui`, Next.js 14 static
export at `/app`: auth, chat, bills, profile, history, dashboard); admin
console; landing page.

## 1. Goal of this sub-project

One backend, one web app, two messengers:

1. The Telegram bot reaches **full parity** with the Bale bot (onboarding
   wizard, home menu, commands, widgets) through a channel-agnostic `bot_core`.
2. `app_ui` runs embedded as a **Telegram Mini App** and a **Bale Mini App**
   (and continues to work in a plain browser), authenticated via host-signed
   `initData`.
3. User identity supports **separate accounts per channel** with an on-demand
   **link/merge** flow.
4. All existing `app_ui` screens are **redesigned via Stitch** into a design
   system (RTL Persian, host-theme aware) that later sub-projects inherit.

Out of scope: payments work (existing Bale wallet code stays untouched and is
simply not extended), phone-number-based linking, any sub-project 1–5 feature.

## 2. Design decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Bot architecture | **Channel-agnostic `bot_core` + thin per-platform adapters** (option A) | One interface for all future features (nudges, gamification, courses); sustainable parity. Fork (B) doubles maintenance; universal adapter (C) lets platform divergences leak into core. |
| Identity | **Separate account per channel; merge on demand** | User's choice. Identity moves to a `(channel, external_id) → user` mapping; merge is user-initiated. |
| Telegram scope | **Full parity now** | Onboarding, home, commands, widgets on both messengers. |
| Payments | **Deferred** | No payment work in this sub-project. |
| Transport | **Long-polling for both bots; no webhooks in production** | Server has no direct Telegram access; Bale webhook code remains in repo, configured off. |
| Telegram connectivity | **All Telegram API traffic via the arvan-zar proxy** (`TELEGRAM_PROXY_URL`) | Iran network constraints; single httpx client with proxy for getUpdates, sends, and getFile downloads. |
| Mini-app auth | **Shared `initData` HMAC validation** for both hosts | Bale copies Telegram's WebAppData scheme exactly; only the signing bot token differs. |
| Design | **Stitch MCP** generates screen designs from briefs grounded in project facts & data models | User requirement; fallback must be agreed with user before substituting. |
| Frontend routing | **`MemoryRouter` when embedded, browser router on web** | Required by Bale iframe BackButton; safe on Telegram. |

## 3. System shape

```
Telegram bot ──getUpdates poll──▶ telegram_adapter ─┐
   (via arvan-zar proxy)                             ├─▶ bot_core (flows: onboarding,
                                                     │     home, commands, widgets)
Bale bot ────getUpdates poll─────▶ bale_adapter ─────┘
                                                    │
app_ui (Telegram MA / Bale MA / browser) ──REST──▶ existing agent, billing, KB,
                                                    profile, memory APIs
```

Single FastAPI deployable, single Postgres database. Pollers run as supervised
in-process tasks (same pattern as the existing Bale poller). Single-instance
constraint accepted, as today.

## 4. Identity model

### 4.1 New table `user_identities`

- `id` UUID PK
- `user_id` UUID FK → `users.id` (CASCADE), indexed
- `channel` String(16) — `bale` | `telegram`
- `external_id` BigInteger — platform user id
- `username` String(200) nullable
- `payload` JSONB default `{}` — first name, language code, etc.
- `created_at`, `last_seen_at` timestamps
- UNIQUE `(channel, external_id)`

### 4.2 Migration & access path

- Alembic migration copies every existing `users.bale_user_id` into a
  `user_identities` row (`channel='bale'`), then **drops** `users.bale_user_id`.
- All code paths currently reading `users.bale_user_id` go through a new
  `UserResolver.resolve(channel, external_id, platform_user) -> User`, which
  finds-or-creates exactly as the current first-contact logic does (and updates
  `username`/`payload`/`last_seen_at` on contact).

### 4.3 Link/merge (minimal increment now)

- Mini app profile section exposes "اتصال حساب‌ها" (link accounts).
- Flow: generate a **single-use, 10-minute, rate-limited** one-time code for the
  initiating (primary) account → user sends `/link <code>` in the *other* bot →
  backend re-points that identity's dependent rows to the primary user.
- Re-pointing is one DB transaction (`UPDATE user_id SET user_id = primary` on
  dependent rows — profile, profile_events, chat sessions/messages, bills,
  onboarding state, memory; **no deletes**). The moved identity keeps its
  `(channel, external_id)` row, now referencing the primary user.
- Merge conflicts: initiating account's profile wins; the absorbed account's
  profile data is archived into an audit row before overwrite. Merges write
  admin audit-log entries.
- No phone infrastructure in this phase.

## 5. Mini-app authentication

Endpoint: `POST /api/app/auth/miniapp` with `{channel, initData}`.

Validation (identical scheme for both hosts, per Telegram WebAppData spec,
which Bale copies):

1. Parse `initData` into key/value pairs; extract `hash`.
2. Build `data_check_string`: all fields except `hash`, sorted by key,
   joined with `\n`.
3. `secret = HMAC_SHA256(bot_token_of_channel, "WebAppData")`
   (`TELEGRAM_BOT_TOKEN` or `BALE_BOT_TOKEN`).
4. Compare `hex(HMAC_SHA256(data_check_string, secret)) == hash` (constant
   time).
5. Reject `auth_date` older than 24 h (configurable `MINIAPP_AUTH_MAX_AGE_S`).

On success: parse `user` from initData → `UserResolver.resolve(channel,
user.id, …)` (find-or-create, per §4.2 — first launch on a new channel yields a
**separate account**, joined to the others only via the link/merge flow). Issue
the same web session token the existing login flow issues (same expiry/cookie
semantics).

Plain-browser login (current magic-link path) continues to work unchanged as
the third auth path.

## 6. `bot_core` and adapters

### 6.1 `bot_core` (new package, pure logic, no HTTP)

- `updates.py` — normalized inbound events, each carrying a normalized
  `PlatformUser` (channel, external_id, display name, username):
  `MessageReceived` (text, attachments, chat ref), `CallbackReceived` (data,
  message ref), `WebAppDataReceived` (data, platform user).
- `actions.py` — outbound action union: `SendText`, `SendMedia`, `EditText`,
  `EditReplyMarkup`, `AnswerCallback`, `SendChatAction`; keyboards and
  multiselect widget payloads expressed platform-neutrally.
- `platform.py` — `PlatformClient` protocol: `perform(action) -> ActionResult`
  (returns platform `file_id`s for caching), `get_file(file_id)`.
- `flows/` — the onboarding phase machine, home menu, command dispatch, and
  multiselect widget state machine are **moved, not rewritten**, from
  `bale_adapter` and `onboarding/`, now consuming normalized updates and
  returning actions. Behavior is unchanged; the accompanying tests move with
  them and keep passing (assertions shift from Bale payloads to actions).

### 6.2 `bale_adapter` (slimmed)

Retains: poller (production transport), webhook endpoint (kept in repo,
configured off), Bale update parsing → normalized events, `BalePlatformClient`
wrapping the existing client, and Bale-only concerns: wallet payments
(untouched), `askReview`, web-login markup, the `unPin` capitalization quirk.
KB media `file_id` caching becomes keyed `(attachment, channel)` so Telegram
uploads never collide with Bale's.

`agent/channels.py` generalizes: `BaleChannel` → per-platform implementation
alongside the existing `WebChannel`.

### 6.3 `telegram_adapter` (new)

- `TelegramPlatformClient`: one httpx client with `proxy=TELEGRAM_PROXY_URL`
  used for **all** Telegram API traffic (sends, getUpdates, getFile downloads).
  Same request/response discipline as the Bale client: check `ok`,
  `error_code`/`description` handling, multipart only for new file uploads,
  64-bit ids.
- `TelegramPoller`: `getUpdates` long-polling with `offset = last committed
  update_id + 1` (offset advances only after durable handling), same lifecycle
  as the Bale poller.
- Update parsing → the same normalized events (field names mirror Bale's
  closely; `web_app_data` handled identically).
- Gated behind `TELEGRAM_ENABLED` (default false) so it ships dark.

### 6.4 Settings (new)

`TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_PROXY_URL`,
`TELEGRAM_API_BASE` (default `https://api.telegram.org`), poll timeout /
`allowed_updates`, `MINIAPP_AUTH_MAX_AGE_S`, `BALE_MINIAPP_URL`,
`TELEGRAM_MINIAPP_URL` (both point at `/app`).

### 6.5 `DeliveryService` (stub for later phases)

A thin interface: `deliver(user_id, action)` fans an action out to **every**
identity of a user via the right adapter. Stubbed in this phase so sub-projects
1–5 never touch adapters directly.

## 7. Mini-app frontend (`app_ui`)

### 7.1 Host integration — `src/lib/miniapp/`

`MiniAppProvider` detects the host once at launch — `window.Telegram.WebApp`
(script from telegram.org), `window.Bale.WebApp` (script from
`tapi.bale.ai/miniapp.js`), or plain browser — and exposes one `useMiniApp()`
API:

- `initData` (for the auth exchange), `version`, `platform`
- `theme` (mapped `themeParams`), `colorScheme` light/dark
- `haptics` — Telegram-only, no-op elsewhere
- `mainButton` — Telegram native; Bale falls back to an in-page sticky button
- `backButton` — show/hide/onClick wiring
- `expand()`, `ready()`, `openInvoice` (no-op this phase)

Components code against this API once and degrade gracefully per host.

### 7.2 Auth

Embedded launches exchange `initData` for the web session (§5) before first
render. Invalid/stale initData → friendly Persian screen: "این بخش داخل بله یا
تلگرام باز می‌شود" with a plain-web login fallback link.

### 7.3 Theming & routing

`themeParams` from either host map onto CSS variables (bg / text / hint /
link / button / secondary bg); `colorScheme` toggles light/dark. **Stitch design
tokens land in these same variables**, so host theme and brand coexist. Embedded
mode uses `MemoryRouter`; browser mode keeps the current router. Static export
(`output: 'export'') stays.

### 7.4 Framing headers

The backend sends, on `/app` responses, `Content-Security-Policy:
frame-ancestors 'self' https://t.me https://web.telegram.org https://*.bale.ai`
and no `X-Frame-Options`. The origin list is a setting
(`MINIAPP_FRAME_ANCESTORS`, defaulting to the list above) so new webview hosts
need no deploy.

### 7.5 Entry points

- Bot menu button per platform — set via each platform's bot admin
  (botfather on both) — **ops task, documented in README**.
- Home menu / command outputs gain `web_app` buttons pointing at the mini-app
  URL (platform-neutral action field; adapters render it per platform).
- Direct links: `https://t.me/<bot>` and `https://ble.ir/<bot>` mini-app links.

## 8. Stitch design workflow

1. Prerequisite: the **stitch MCP server** (`https://stitch.googleapis.com/mcp`)
   must be connected (currently configured but tools fetch failed — timed out).
   Reconnect before UI work starts.
2. I drive Stitch with briefs grounded in project facts: Persian/RTL,
   mobile-first ~390 px, the actual screens (dashboard, chat, bills list +
   bill detail, profile, history, auth/entry, link-accounts) and the data
   models behind them (bill fields, insight cards, profile sections).
3. Generated designs are reviewed with the user, then implemented as Tailwind
   design tokens + a small component kit that sub-projects 1–5 inherit.
4. If Stitch stays unreachable, I flag it and **agree a fallback with the user
   before substituting any design approach** — no silent substitution.

## 9. Error handling

- **Pollers:** offset commits only after durable handling; a poison update
  (handler crash) is logged, skipped after 3 attempts, never blocks the queue.
  Proxy/API failures → exponential backoff (capped, jittered), health exported
  to `/metrics` (poll lag, consecutive failures). Startup `getMe` fails fast
  with a pointed log line (check `TELEGRAM_PROXY_URL` / arvan-zar
  reachability).
- **10-second callback rule:** `answerCallbackQuery` fires immediately; slow
  work (LLM) continues async — the existing pattern.
- **Mini-app auth:** tampered hash, wrong-token signature, stale `auth_date`
  → 401 → fallback screen; sessions refresh on relaunch.
- **Link/merge:** single-use codes, 10-minute expiry, per-user rate limit;
  re-pointing is one transaction (no half-merge); audit-log entries on merge;
  archive absorbed profile before overwrite.
- **Webhook (Bale, off by default):** unchanged behavior when enabled.

## 10. Testing

- **Unit**
  - Update normalization from recorded Bale **and** Telegram payloads.
  - Moved flow tests (onboarding, home, commands, multiselect) assert on
    actions — platform-free; adapter mapping tests translate actions to
    platform payloads.
  - Mini-app HMAC validation for both hosts: valid, tampered hash, wrong
    token, expired `auth_date`.
  - Link-code lifecycle: expiry, single-use, rate limit; merge re-pointing.
  - Proxy configuration via httpx `MockTransport` (all traffic through proxy).
- **Integration** (test DB, `docker-compose.test.yml` on :5433):
  first-contact identity creation per channel; poller offset discipline across
  restart; merge with FK integrity; mini-app auth end-to-end issuing a working
  session.
- **Existing tests keep passing** — Bale parser/command tests adapt through the
  adapter mapping; `test_bale_poller` discipline carries to the Telegram
  poller's tests.
- **Manual QA per host** on real devices (Bale Android/iOS, Telegram
  Android/iOS + web) — webview behavior varies; the device checklist is part
  of done.

## 11. Rollout sequencing

1. `user_identities` migration + `UserResolver` (Bale behavior unchanged).
2. `bot_core` extraction; tests move with the flows; `bale_adapter` on top.
3. Telegram adapter + arvan-zar proxy + poller (dark, behind
   `TELEGRAM_ENABLED`).
4. Mini-app auth endpoint + `app_ui` host integration (functional, existing
   styling).
5. Stitch redesign of all screens → implement (§8).
6. Link-accounts flow + admin identity/merge views (channel column on user
   list, audit entries) woven in.

## 12. Out of scope (explicit)

Payments (new work), phone-number linking, Telegram Bot Payments/Stars,
gamification, courses, bill OCR, nudges, SEO website, multi-instance polling,
onboarding redesign (the 2026-07-12 flow is preserved as-is).
