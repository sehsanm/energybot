# Legacy System Review — Python Energybot (what we built so far)

**Date:** 2026-10-03
**Purpose:** Inventory of the existing Python system before the Next.js rewrite
(`docs/2026-10-03-nextjs-rewrite-plan.md`). The old app stays in place at the repo
root until the replacement works; it is then archived.

---

## 1. What the product does today

A **Persian-language energy-saving assistant** delivered as a bot on **Bale
messenger** (Iranian Telegram-compatible platform), plus a user web app and an
admin console. Built for ~50 beta users, single Iran VPS.

Core user journey: first contact → 4-phase onboarding (profile wizard →
motivations multi-select → first bill → service toolbox) → home menu with reply
keyboard → send bill (photo / PDF / typed 26-digit ID) → barcode or checksum
parse → Finnotech inquiry → bill summary + payment link → LLM-generated,
fully-quantified savings suggestions → free chat with an AI agent that has tools
(profile, bills, KB search, memory).

## 2. Architecture

- **Backend:** Python 3.12 / FastAPI single deployable (`src/energybot/`),
  SQLAlchemy 2 async + asyncpg, Alembic (12 migrations), Postgres 16 + pgvector
  + pg_trgm, APScheduler in-process jobs, structlog JSON logs, Prometheus
  `/metrics`, argon2 admin passwords.
- **Channels:** hand-rolled Bale adapter (webhook + long-polling modes), no bot
  framework. Telegram was specced (`docs/superpowers/specs/2026-10-01-miniapp-dual-channel-design.md`)
  but never built.
- **Frontends:** three separate Next.js 14 static exports — `app_ui` (user web
  app at `/app`: auth, chat SSE, bills, profile, history, dashboard),
  `admin_ui` (at `/admin`: dashboard, users, chats, KB editor, prompts,
  models, bills, incentives, audit), `landing_ui` (at `/`).
- **AI:** OpenAI-compatible provider layer over three providers (frontier via
  proxy, Metis, DeepSeek) with DB-driven per-call-type routing and fallback
  chains; every call logged to `llm_calls`.
- **Deploy:** Docker Compose on one VPS (`bin/deploy.sh` → `arvandev`), behind
  local TLS proxy. ~371 pytest tests.

## 3. Feature inventory (maturity)

| Feature | Status | Where |
|---|---|---|
| Bale bot: onboarding (4 phases), home menu, commands, multiselect widgets | Mature | `bale_adapter/`, `onboarding/` |
| Bill capture: photo/PDF barcode (pyzbar/PyMuPDF), typed-ID mod-11 checksum | Mature | `billing/barcode.py`, `pdf.py`, `bill_numbers.py` |
| Finnotech inquiry (token cache, detail extraction, per-bill cache) | Mature | `finnotech_client.py`, `bill_details.py`, `repository.py` |
| Bill payment (generic redirect gateway + callback) | Working, fake provider by default | `payment.py`, `callback.py` |
| LLM bill suggestions (quantified tips + targets → profile goals) | Mature | `suggestions.py` + `bill_suggestions` prompt |
| AI chat agent, 8 tools, rolling summaries, LLM user memory (~40 cap) | Mature | `agent/` |
| Knowledge base: 14 Persian articles, hybrid pgvector+trgm retrieval, media | Mature | `kb/`, seed data below |
| Profiles: JSONB household/behaviour/goals/commitments/service_prefs + audit | Mature | `profile/` |
| Web app (magic-link login, SSE chat, bills, dashboard) | Mature | `user_api/`, `app_ui/` |
| Admin console (users, chats, KB, prompts, models, bills, incentives, audit) | Mature | `admin_api/`, `admin_ui/` |
| Incentives money-back data layer (Tavanir programs, admin-editable) | Data only, no user surface | `incentives/` |
| Notifications/nudges, courses, gamification, Telegram, mini app, SEO site | Not built (specced only) | specs |

## 4. Data model (Postgres, 30 tables)

`users` (bale_user_id), `profiles`, `profile_events`, `onboarding_states`,
`chat_sessions`, `messages`, `chat_summaries`, `user_memories`, `kb_articles`,
`kb_attachments` (bale_file_id cache), `video_transcripts`, `kb_chunks`
(vector 1536), `admin_users`, `admin_sessions`, `prompt_templates` (versioned),
`model_configs`, `audit_log`, `llm_calls`, `processed_updates`, `daily_stats`,
`utility_subscriptions`, `bills` (details + suggestions JSONB), `bill_payments`,
`incentive_param_set`, `city_climate_zone`, `web_login_tokens`, `user_sessions`.

## 5. Salvage list → where it goes in the rewrite

Ported (logic + tests carry over, language changes Python → TypeScript):

| Asset | Source | Destination |
|---|---|---|
| Bill ID mod-11 checksum, service-type digit, Persian-digit normalization | `billing/bill_numbers.py` (69 lines) | `web/src/lib/billing/billNumbers.ts` |
| Finnotech inquiry client (OAuth client-credentials, trackId, DONE-status discipline) | `billing/finnotech_client.py` | `web/src/lib/billing/finnotech.ts` (inquiry only) |
| Electricity bill detail normalizer (buckets, amounts split, period) | `billing/bill_details.py` | `web/src/lib/billing/billDetails.ts` |
| Bill suggestions: context builder (seasons, densities, deltas, rial→toman), JSON parse, Persian renderer, targets→goals | `billing/suggestions.py` | `web/src/lib/billing/suggestions.ts` |
| `bill_suggestions` prompt (Jinja → simple template) + persona prompt | `scripts/seed_data/prompts/*.md` | `web/src/content/prompts/` |
| 14 Persian KB articles (electricity 6, gas 5, general 3) | `scripts/seed_data/kb/**/*.md` | `web/src/content/kb/` |
| Persian UI copy (home, onboarding, wizard, billing messages) | `bale_adapter/home.py`, `onboarding/content.py`, `handler.py` | `web/src/content/copy.ts` |
| Bale Bot API client discipline (ok-check, file download, chat-action best-effort) | `bale_adapter/client.py` (88 lines) | `web/src/lib/channels/bale.ts` |
| Session tokens (sha256 server-side id), CSRF HMAC | `core/security.py` | `web/src/lib/auth/` |
| Mini-app `initData` HMAC validation scheme (both hosts share Telegram's WebAppData design) | 2026-10-01 spec §5 | `web/src/lib/miniapp/` |
| Bill fixtures (real bill PDF/PNG) | `tests/fixtures/` | `web/tests/` for parser verification |

Deliberately dropped in the rewrite (v1): payments, pgvector hybrid retrieval
(replaced by simple search in v2), DB-driven prompt/model tables (files + env
instead), APScheduler jobs, Postgres (→ SQLite), the three-static-export split
(→ one Next.js app), wallet/webhook Bale extras.

Not salvageable (stays archived with the old app): FastAPI plumbing, SQLAlchemy
models/migrations, agent loop internals (re-conceived for v2 chat), admin_ui /
app_ui / landing_ui codebases.

## 6. Production data to migrate

Users (with `bale_user_id` → identities), profiles (household/behaviour/goals),
bills (with details + suggestions), recent messages. See rewrite plan §7.
