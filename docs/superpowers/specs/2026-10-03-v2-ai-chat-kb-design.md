# Design: AI Chat + Knowledge Base + Memory (Sub-project v2)

**Date:** 2026-10-03
**Status:** Approved (design); proceeding to implementation plan
**Owner:** Sehsanm
**App:** the Next.js/SQLite app in `web/` (v1 shipped: bots, bill insights, admin, mini-app)
**Brainstorm:** `../brainstorms/2026-10-03-v2-ai-chat-kb-brainstorm.md`
*(retroactively documented — process corrected: future sections brainstorm first)*

---

## 0. Goal

Give users an AI assistant grounded in our Persian energy-saving knowledge base,
available on all three surfaces (Bale bot, Telegram bot, web/mini app), with a
long-term user memory that personalizes answers over time. This is v2 of the
rewrite roadmap (`docs/2026-10-03-nextjs-rewrite-plan.md` §9); v1's
"fallbackText" bot replies and missing chat page are replaced.

## 1. Locked design decisions

| Decision | Choice | Rationale |
|---|---|---|
| Chat architecture | **No tool-calling loop.** Deterministic pipeline: KB search (code) → context assembly → one answer call | Legacy's 8-tool loop is the biggest complexity carrier; deterministic search gives the same grounding with half the moving parts. Tools can return in v3 if needed |
| KB retrieval | **SQLite FTS5 (bm25) over normalized chunks** — no embeddings, no pgvector | Single-file DB; the 14-article corpus is small and lexical search on normalized Persian is sufficient; legacy hybrid RRF was built for scale we don't have |
| Chunking | Character-based port of the legacy paragraph/sentence chunker (~1,200 chars, 200-char overlap) | Same structure without the tiktoken dependency |
| Persian normalization | Port of legacy `normalize_fa.py` (Arabic→Persian chars, Arabic→Persian digits, ZWNJ folding, whitespace, lowercase) applied to chunk index and query | Parity with the proven legacy retrieval preprocessing |
| Streaming | **Not now.** Plain JSON response; bots show typing, web shows a spinner | SSE pseudo-streaming can be added later behind the same API |
| Memory | **Post-turn extraction**: after each exchange, a second (cheap) AI call may add/update/remove memory items; stored in `user_memories` (5 legacy categories, ~40 cap), rendered into the next system prompt with `[id]` markers | Keeps the answer path single-call; extraction is idempotent and skippable (`AI_MEMORY_ENABLED`, default on) |
| Citations | Model names the article titles it used inline («بر اساس مقالهٔ «ساعات اوج…»») — no numbering machinery | Simple, honest, renders everywhere (bot + web) |
| KB content source | The 14 ported articles in `src/content/kb/` seed the DB on first boot; admin can edit/publish; edits re-chunk + re-index | Content lives in git for versioning, DB for search |
| History | Rolling window of the last 8 exchanges (16 rows) from the existing `messages` table, per user across channels | No new session machinery; legacy keyed conversations by user too |
| Bot routing | Typed bill IDs still route to billing **before** chat; commands unchanged | v1 behavior preserved |

## 2. Data model (SQLite)

- `kb_articles(id TEXT pk, slug TEXT unique, title, body_md, category, tags TEXT json, status 'draft'|'published', source 'seed'|'admin', created_at, updated_at)`
- `kb_chunks(id INTEGER pk, article_id FK→kb_articles CASCADE, chunk_index INT, text, text_normalized)` + index on article_id
- `kb_fts` — **FTS5 virtual table** `(chunk_id UNINDEXED, text_normalized)`, created at runtime by the repository (`CREATE VIRTUAL TABLE IF NOT EXISTS`), kept in sync by the repository (delete+insert on re-index), not by drizzle migrations
- `user_memories(id INTEGER pk, user_id FK→users CASCADE, category, text, created_at, updated_at, deleted_at)` + index (user_id, deleted_at)

## 3. Pipeline (`src/lib/chat/pipeline.ts`)

```
user text ─▶ normalizeFa ─▶ FTS5 search (top 4 published chunks, bm25)
                    │
                    ▼
  system prompt = persona (ported from legacy system_prompt.md, tool section removed,
                citation rule added)
                + profile summary (household/behaviour/goals — ported renderer)
                + latest bill headline (amount/term/consumption when present)
                + rendered memories (legacy render_memory with [id] markers)
                + KB context block (each hit: «title» + chunk text)  [only on hits]
  messages = last 8 exchanges + new user text
                    │
                    ▼
        aiChat(...) ─▶ reply (2–6 sentences, Persian, safety rules intact)
                    │
                    ▼
  post-turn: memory extraction prompt (current memories + exchange)
             ─▶ {add:[{category,text}], remove_ids:[…]} — applied in code, capped at 40
```

Failure behavior: AI failure → bots reply the v1-style friendly error, web gets a 502 JSON; memory extraction failure is silently logged (never blocks the reply). No-KB-hit → the persona instructs an honest general answer with a disclaimer.

## 4. Surfaces

- **Bots:** plain text (that is not a command/bill-id) goes to the pipeline; reply sent as before; exchange logged (`role user/bot`) — replaces `fallbackText`.
- **Web/mini app:** new `/chat` page (message list from `messages` desc + input + send); `POST /api/chat {text}` (session + CSRF) returns `{reply}`; `GET /api/chat/history` returns the last 50. Bottom-nav gains «گفتگو».
- **Admin:** new KB section — article list (status, chunk count), edit title/body/category/tags, publish/unpublish (re-indexes), plus the user's chat log already visible in the user detail page.

## 5. Out of scope (explicit)

Embeddings/vector search, tool calling, SSE streaming, KB media/attachments,
escalation, rolling conversation summaries (the 8-exchange window replaces them),
suggest-actions buttons, public KB article pages (v5 SEO site), nudges (v4).

## 6. Testing

- Unit: normalizeFa matrix; chunker (short/long/paragraph-boundary/overlap); frontmatter parser; renderMemory categories.
- Repository (test DB): seed-from-files idempotency; FTS search finds Persian matches across ZWNJ/Arabic variants; draft exclusion; re-index on edit; publish flow.
- Pipeline (AI mocked): context assembly order & content; KB hits injected only on match; reply failure path; memory add/remove/merge + 40-cap; memory disabled flag.
- Handler: plain text routes to chat (bill-id still routes to billing); reply logged.
- API: /api/chat auth+CSRF; history shape.

## 7. Rollout

1. Schema + migration (drizzle) + FTS5 runtime table
2. KB: normalize, chunk, repository (seed/search/reindex), admin API
3. Chat: persona prompt, context builder, pipeline, memory
4. Surfaces: bot wiring, /api/chat + /chat page, admin KB pages
5. Tests green + build + smoke; SDD review artifacts
