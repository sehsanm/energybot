# Energybot — Next.js app (v1 rewrite)

Single Next.js application with SQLite that replaces the legacy Python/FastAPI
system: dual-channel bots (Bale + Telegram), bill upload + AI insights, mini-app
embedding for both hosts, and an admin console. See
`docs/2026-10-03-legacy-system-review.md` and
`docs/2026-10-03-nextjs-rewrite-plan.md` in the repo root for the full story.

## Stack

- Next.js 15 (App Router, TypeScript) — one Node process; **no serverless** (SQLite + in-process bot pollers)
- SQLite via better-sqlite3 + Drizzle ORM (WAL, auto-migrated on boot)
- Tailwind CSS (RTL Persian, mobile-first) — host themeParams map onto the same CSS variables
- Bots: hand-rolled Bale client (`tapi.bale.ai`) + Telegram client (all traffic via `TELEGRAM_PROXY_URL`), long-polling started by `src/instrumentation.ts`
- AI: any OpenAI-compatible endpoint (`AI_*` env), used for bill insights
- Bill data: barcode via sharp + zxing (photos) / pdfjs-dist + @napi-rs/canvas (PDFs), typed-ID mod-11 checksum, Finnotech inquiry (inquiry only — no payments)

## Run (dev)

```bash
cd web
cp .env.example .env   # fill in what you have; bots default to disabled
npm install
npm run dev            # http://localhost:3000
```

First boot auto-creates `data/energybot.db`, runs migrations, and bootstraps
the first admin from `ADMIN_BOOTSTRAP_EMAIL/PASSWORD` (only if no admin exists).

Without Finnotech credentials a deterministic fake client answers inquiries, so
the whole flow is usable in dev.

## Test / verify

```bash
npm test               # vitest — parsers, initData HMAC, identity, suggestions, barcode fixtures
npx tsc --noEmit       # types
npm run build          # production build
BASE_URL=http://localhost:3000 npx tsx scripts/smoke.ts   # user-flow smoke against a running server
```

`tests/fixtures/bill_barcode_sample.{png,pdf}` are real bills carried over
from the legacy suite — they prove the zxing port matches pyzbar.

## Migrate data from the legacy Postgres app

```bash
LEGACY_DATABASE_URL=postgres://user:pass@host:5432/energybot npm run migrate:legacy -- --dry-run
LEGACY_DATABASE_URL=... npm run migrate:legacy            # users+identities+profiles+bills
LEGACY_DATABASE_URL=... npm run migrate:legacy -- --messages   # also recent messages
```

Idempotent per legacy id (safe to re-run). The 14 Persian KB articles are
already ported to `src/content/kb/` for the v2 chat phase.

## Bots

Both bots ship dark: set `BALE_ENABLED=true` (+`BALE_BOT_TOKEN`) and/or
`TELEGRAM_ENABLED=true` (+`TELEGRAM_BOT_TOKEN`, +`TELEGRAM_PROXY_URL` — required
from Iran, e.g. arvan-zar). Pollers start with the server; update dedup and
offsets live in `processed_updates`. Bot features: onboarding-lite (city +
utility), bill photo/PDF/typed-ID capture → summary → AI insights, `/web` magic
link, mini-app buttons.

Mini-app setup (ops): set the bot menu button to `PUBLIC_BASE_URL` on both
platforms (BotFather for Telegram, @BotAdmin for Bale).

## Deploy (single VPS container)

```dockerfile
FROM node:22-slim
WORKDIR /app
COPY web/package*.json ./
RUN npm ci --omit=dev
COPY web/ .
RUN npm run build
ENV NODE_ENV=production DATABASE_PATH=/data/energybot.db
EXPOSE 3000
CMD ["npm", "start"]
```

Backups: snapshot the SQLite file (`sqlite3 data/energybot.db ".backup ..."` or
copy the volume while stopped). Migrations run automatically on boot.

## Layout

```
src/
  app/            user pages (/ dashboard, /bills, /profile, /login) + /admin + /api routes
  lib/
    db/           drizzle schema + singleton connection
    billing/      billNumbers, billDetails, finnotech, extract (barcode/pdf), service, suggestions, json
    channels/     bale, telegram (proxy), poller, deliver, types
    auth/         initData HMAC, sessions, login tokens, api guards
    bot/          update handler + identity resolution
    ai/           OpenAI-compatible client
    miniapp/      host detection + theming (client)
  content/        Persian copy, KB articles (v2), prompts
scripts/          migrate-from-legacy.ts, smoke.ts
tests/            vitest + fixtures
```

## Legacy archival (later, not now)

When this app takes over: move `src/`, `alembic/`, `scripts/`, `admin_ui/`,
`app_ui/`, `landing_ui/` and the Python tooling to `legacy/` (or a branch) —
the rewrite plan §10 has the checklist.
