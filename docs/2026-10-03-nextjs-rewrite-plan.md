# Energybot Rewrite Plan — Single Next.js App with SQLite

**Date:** 2026-10-03
**Status:** Approved
**Supersedes:** the sub-project 0 implementation path (the 2026-10-01 mini-app
spec's *goals* carry over; its Python implementation does not).

---

## 0. Decision

Rebuild energybot as **one Next.js application** (App Router, TypeScript,
Tailwind) with **SQLite** (Drizzle ORM), living in `web/` beside the untouched
Python app until the switch, then the Python app is archived. Rationale:
collapse three static exports + FastAPI into one deployable Node process,
remove Postgres/pgvector operational weight, and make the website/mini app/bot
one codebase.

**v1 scope (locked with user, 2026-10-03):**
- Telegram + Bale bots from day one (long-polling, in-process)
- Bill upload (photo / PDF / typed ID) → parse → Finnotech inquiry → AI insights
- Admin area (users, interactions, bills + insights, manual send)
- Mini-app embedding (both hosts) + basic web pages (dashboard, bills, profile)
- Data migration from legacy Postgres (users, profiles, bills, messages)

**Explicitly later:** AI chat + KB search (v2), mini courses + gamification +
Gemini TTS (v3), nudge engine (v4), payments, account linking, weather/news.

## 1. Stack

| Concern | Choice |
|---|---|
| Framework | Next.js (App Router) + TypeScript, single Node process (no serverless; SQLite requires it) |
| DB | SQLite via better-sqlite3 + Drizzle ORM + drizzle-kit migrations |
| Styling | Tailwind; RTL Persian, mobile-first; design language from **Stitch** when its MCP is reachable (fallback only by agreement) |
| Bots | Hand-rolled thin clients for Bale (`tapi.bale.ai`) and Telegram (all traffic via `TELEGRAM_PROXY_URL`), long-polling started from `instrumentation.ts` (singleton-guarded, update-id dedup in SQLite) |
| AI | One OpenAI-compatible client (`ai/provider.ts`); provider/model from env (`AI_PROVIDER`, `AI_MODEL`, per-need overrides); prompts as files in `src/content/prompts/` |
| Auth | User sessions: mini-app `initData` HMAC exchange (identical scheme both hosts) + bot-issued magic link; Admin: email+password (argon2 via `@node-rs/argon2`) |
| Tests | Vitest (parsers, HMAC, auth, suggestion pipeline) |

## 2. Directory map (`web/`)

```
web/
  src/
    app/                    # routes
      (site)/               # dashboard, bills, profile (user, session-gated)
      admin/                # admin console
      api/                  # route handlers: auth, bills, insights, admin, webhook-less
    lib/
      db/                   # drizzle client + schema + migrations
      billing/              # billNumbers, billDetails, finnotech, suggestions, extract (zxing/pdf)
      channels/             # bale.ts, telegram.ts, types (normalized send API), poller
      ai/                   # provider client
      auth/                 # sessions, initData validation, admin auth
      miniapp/              # host detection hook (client)
    content/
      kb/                   # 14 ported Persian articles (v2 uses them)
      prompts/              # bill_suggestions + persona
      copy.ts               # all Persian UI/bot strings
  scripts/
    migrate-from-legacy.ts  # Postgres → SQLite
  tests/                    # vitest, incl. legacy bill fixtures
```

## 3. Schema (SQLite, v1)

- `users(id, display_name, language, is_blocked, created_at, last_seen_at)`
- `user_identities(channel 'bale'|'telegram', external_id, username, payload JSON, UNIQUE(channel, external_id))` — the identity model from the 2026-10-01 spec, adopted day one
- `profiles(user_id PK, household JSON, behaviour JSON, goals JSON)`
- `bills(id, user_id, bill_id, pay_id, utility_type, amount, term, due_date, consumption, details JSON, suggestions JSON, created_at)`
- `messages(id, user_id, channel, role, content, meta JSON, created_at)` — unified bot+web interaction log
- `processed_updates(update_id PK)` — poller dedup
- `admin_users(id, email, password_hash, created_at)`
- `sessions(id, user_id NULL|admin_id, kind 'user'|'admin', expires_at)`

Prompts and model routing live in files/env — deliberate simplification vs the
legacy prompt_templates/model_configs tables.

## 4. Bot behavior (v1, simplified from legacy)

- `/start` → welcome + mini-app button (+ onboarding-lite: city + utility type)
- `/help`, `/web` (login link)
- Photo / PDF / typed-ID → bill capture → inquiry → summary + inline buttons
  (نکات صرفه‌جویی → insights reply; باز در مینی‌اپ)
- Plain text → friendly Persian pointer (full AI chat = v2)
- Insights generation runs after capture (same flow as legacy: context builder →
  prompt → JSON → render + store; regenerate/send from admin)

## 5. Web + mini app

- `MiniAppProvider` detects `window.Telegram.WebApp` / `window.Bale.WebApp` /
  browser; `useMiniApp()` exposes initData, theme→CSS vars, backButton, haptics
  (TG-only), mainButton (Bale in-page fallback). MemoryRouter embedded.
- `POST /api/auth/miniapp {channel, initData}` — HMAC-SHA256 validation
  (secret = HMAC(bot_token, "WebAppData"), constant-time compare, auth_date ≤
  24h) → find-or-create user → session cookie.
- Magic-link fallback login (bot `/web`) unchanged in spirit from legacy.
- CSP `frame-ancestors` allows t.me / web.telegram.org / *.bale.ai.

## 6. Admin (`/admin`)

Password login; dashboard (users, bills, messages/day); users list + detail
(identities, profile, bills, interaction log); bill insights regenerate + send;
manual message send to a user via their channel (nudge-lite); audit log of
admin actions.

## 7. Data migration (`scripts/migrate-from-legacy.ts`)

Reads legacy Postgres (`LEGACY_DATABASE_URL`), writes SQLite: users →
users + `bale` identities; profiles (household/behaviour/goals); bills
(details/suggestions); last N messages per user. Idempotent (upsert by legacy
id), `--dry-run` mode. KB articles already copied to `src/content/kb/`.

## 8. Verification

Vitest suites: billNumbers (checksum/service-type/FA digits), billDetails
normalizer (against recorded Finnotech payloads), suggestions context+parse+render,
initData HMAC matrix, session/auth. Manual smoke: both bots in dev polling mode,
mini app in Telegram/Bale webviews, browser fallback. `web/README.md` covers run
+ deploy (single Node container, SQLite file + backup).

## 9. Phase roadmap after v1

| Phase | Contents | Status |
|---|---|---|
| v2 | AI chat + KB (ported articles, simple semantic/keyword search), memory | **shipped 2026-10-03** (FTS5-grounded chat on bots + web, admin KB editor, user memory) |
| v2.5 | **UI redesign implementation** (Stitch): tokens → shadcn theme → kit → retrofit all pages; landing at `/`, dashboard at `/home`; embedded `MemoryRouter`; admin screens via Stitch then retrofit | **in flight** — user-app screens generated & **gate 1 approved 2026-10-03**; implementation ahead; admin screens pending |
| v2.6 | **In-app onboarding wizard** — rebuilt as a 7-step /welcome flow (welcome, household ×3, motivations, first-bill inline capture, toolbox) with skip-as-escape, resume from profile, shared completion flag (app or bot-lite), queue-and-resend saves; spec `docs/superpowers/specs/2026-10-03-v2.6-onboarding-wizard-design.md` | **shipped 2026-10-03** (walkthrough-verified; bot-lite keeps its chat flow, either completes) |
| v2.7 | **KB expansion** — 52 course-ready Persian articles across 11 clusters (utility/difficulty/minutes/sources/objectives/keyFacts metadata); article schema + boot-time seed reconciliation; lint-gated, user-checkpointed content production | **shipped 2026-10-20** (206→276 tests; chat grounding enriched as clusters merged) |
| v3 | Duolingo-style mini courses (Persian, MCQ + calculators), gamification core (XP/streaks/badges/coins), Gemini TTS voice | **shipped 2026-10-21** (pilot course + engine + TTS pipeline; 449 tests; v3.x = 10 course campaigns) |
| v4 | Nudge engine (memory + weather + news), admin-triggered campaigns | |
| v5 | Public SEO website surfaces (the Next app natively serves them), knowledge↔course↔site interlinking; legacy Python archival after the switch is confirmed | |

Deferred (explicit): payments, account link/merge (revisit when real users
appear on both channels).

## 10. Legacy archival (after v1 is live)

Move `src/`, `alembic/`, `scripts/`, the three `*_ui/` folders and Python
tooling to `legacy/` (or a `legacy/python` branch), keeping `web/` + `docs/` at
root — separate step, only when the user confirms the switch.
