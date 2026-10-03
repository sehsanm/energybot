# Brainstorm: v2 — AI Chat + Knowledge Base + Memory

**Date:** 2026-10-03
**Status:** ⚠️ Retroactive — recorded after implementation began. The decisions
below were genuinely weighed in conversation, but this document was written
after the spec, violating the brainstorm → spec → plan order. Process corrected
as of 2026-10-03: every future section starts here, BEFORE the spec.
**Spec:** `../specs/2026-10-03-v2-ai-chat-kb-design.md`

---

## Problem

v1 shipped bots, bill capture + insights, admin, and the mini-app — but no way
to *ask anything*. The 14 Persian energy-saving articles sit in
`src/content/kb/` powering nothing, bot free-text gets an apologetic fallback,
and interactions are not personalized. What shape should "the assistant" take
in the simplified Next.js/SQLite world?

## Questions explored and options weighed

### Q1 — How does the chat get grounded in our content?
| Option | Pros | Cons |
|---|---|---|
| A. Stuff the whole KB into every prompt | trivial | ~50 KB of unfocused context, cost, noise |
| B. Vector RAG (embeddings + cosine, like legacy pgvector) | best recall, semantic | embedding dependency + pipeline; overkill for 14 articles |
| C. **Lexical FTS5 (bm25) over normalized chunks** | zero new infra, SQLite-native, fast | misses paraphrases; fine at this corpus size |

**→ C.** With the legacy Persian normalization (Arabic→Persian letters/digits,
ZWNJ folding) ported so the quirks that break naive Persian search are handled.
Embeddings remain an upgrade path (swap the search function, schema already
chunk-based). New need vs legacy: an FTS5-safe query builder (quoted prefix
terms) and a Persian stopword list — tsquery handled junk that raw FTS5 MATCH
syntax would reject.

### Q2 — Agent with tools (legacy parity) or a deterministic pipeline?
| Option | Pros | Cons |
|---|---|---|
| A. Tool-calling loop like legacy (8 tools) | flexible, legacy-proven | loop caps, tool schemas, JSON-parse failure modes — the biggest complexity carrier of the old agent |
| B. **Deterministic pipeline: search in code → inject context → one answer call** | one AI call, fully unit-testable, cheap, no tool-JSON failure class | model can't pull extra context on its own |

**→ B.** The grounding Q1 already gives us (KB), plus code-assembled profile /
bill / memory context, covers what the legacy tools were used for in practice.
Revisit tools when a feature genuinely needs model-initiated actions.

### Q3 — How does long-term memory work without an in-loop tool?
| Option | Pros | Cons |
|---|---|---|
| A. Legacy style: `manage_memory` tool inside the agent loop | one LLM call total | drags the whole tool loop back in (see Q2) |
| B. **Post-turn extraction: second cheap call after each exchange** | keeps answer path single-call; extraction failure never hurts the user | +1 call per exchange (toggleable `AI_MEMORY_ENABLED`) |
| C. No memory | cheapest | loses personalization the roadmap promises |

**→ B.** Categories, ~40 cap, `[id]` markers and renderer ported verbatim from
legacy; removal by id keeps the list clean.

### Q4 — Conversation state?
Session tables + rolling summaries (legacy) vs a **rolling window over the
existing `messages` table** (last 8 exchanges, per user across channels).
The window reuses v1 logging, zero new machinery; summaries return if windows
prove too short.

### Q5 — Streaming replies?
SSE pseudo-streaming (legacy web) adds an event protocol for 2–6-sentence
replies. **Defer** — typing indicator (bots) and spinner (web) suffice; the
API shape allows adding SSE later without redesign.

### Q6 — Where does KB content live?
DB-only (admin as source of truth) vs **files in git, seeded to DB**: files
keep review/history; the DB gets chunks + FTS for search; admin edits re-chunk
and re-index on save. Drafts drop out of the index until published.

### Q7 — Citations?
Numbered `[1]` machinery + link map vs **inline article titles** («بر اساس
مقالهٔ «ساعات اوج…»»): renders identically in Bale, Telegram and the web app
with no post-processing.

## Open questions deferred (tracked)
- Embedding upgrade path if FTS5 recall disappoints on real queries (v2.5+)
- Memory extraction cadence — every exchange vs only "autobiographical" turns (cost lever)
- Admin-triggered full reindex tool (per-article reindex ships in v2)
- Public KB article pages — deliberately v5 (SEO site), not v2

## Outcome
Decisions above fed `2026-10-03-v2-ai-chat-kb-design.md` (§1 locked decisions)
and the implementation plan. Next section (v3: courses + gamification + Gemini
TTS) starts with a live brainstorm, in order, before any spec.
