# Implementation Plan: v2 — AI Chat + KB + Memory

Spec: `docs/superpowers/specs/2026-10-03-v2-ai-chat-kb-design.md`
App: `web/` (Next.js + SQLite + Drizzle). All tasks TDD where a unit boundary exists.

## Task 1 — Schema & migration
- `kb_articles`, `kb_chunks`, `user_memories` in `src/lib/db/schema.ts`; drizzle migration 0002
- FTS5 virtual table created by the repository at runtime (not drizzle)
- Files: schema.ts, drizzle/0002_*.sql
- Test: makeTestDb() applies cleanly (implicit in every later test)

## Task 2 — KB text machinery
- `src/lib/kb/normalize.ts` — port normalize_fa (Arabic→Persian letters/digits, ZWNJ fold, whitespace, lower)
- `src/lib/kb/chunk.ts` — char-based port (~1200 chars, 200 overlap, paragraph→sentence fallback)
- `src/lib/kb/frontmatter.ts` — title/category/tags parser for the seed files
- Tests: matrix per module

## Task 3 — KB repository
- `src/lib/kb/repository.ts`: `ensureSeeded(db)` (loads src/content/kb/**/*.md when table empty),
  `ensureFts(db)` (CREATE VIRTUAL TABLE IF NOT EXISTS), `searchKb(db, query, k)` (bm25, published only),
  `saveArticle` (upsert + re-chunk + re-index), `listArticles`, `getArticle`
- Startup wiring in instrumentation (seed + FTS)
- Tests: idempotent seed, Persian/ZWNJ/Arabic search variants, draft excluded, edit re-indexes

## Task 4 — Chat pipeline + memory
- `src/content/prompts/chatPersona.ts` (persona ported; tools section removed; citation + KB rules)
- `src/content/prompts/memoryExtraction.ts`
- `src/lib/chat/context.ts`: profile summary renderer (port), latest-bill headline, memory render (port), KB block
- `src/lib/chat/pipeline.ts`: `answerChat(userId, text, db)` → {reply}; `extractMemory` post-turn (add/remove/cap 40; `AI_MEMORY_ENABLED`)
- `src/lib/chat/memoryRepository.ts`
- Tests (AI mocked): assembly, no-hit path, failure path, memory merge/cap/disable

## Task 5 — Surfaces
- Bot handler: plain text → `answerChat` (bill-id & commands first); log exchange
- `POST /api/chat`, `GET /api/chat/history` (session + CSRF on POST)
- `/chat` page + bottom-nav item
- Admin: `GET/PUT /api/admin/kb`, `POST /api/admin/kb/[id]/publish`, admin KB pages (list/edit)
- Tests: handler routing, memory-repo, admin API guards (unit level where feasible)

## Task 6 — Verify + SDD artifacts
- Full suite + tsc + build; smoke (chat API 401/403 paths without creds)
- `.superpowers/sdd/` review artifacts + progress update; commit
