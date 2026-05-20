# Energybot — Phase 1 Design

**Date:** 2026-05-21
**Status:** Draft, pending user review
**Scope:** Phase 1 only. Bills, IoT, cashback/wallet, appliance ROI, meter photo, and full mini-app are deferred to later phases.

---

## 0. Background and goals

Energybot is a Persian-language energy-saving assistant. Users chat with it in Bale messenger (`bale.ai`). The assistant educates them on electricity- and gas-saving techniques, builds a profile of each user over time, and uses that profile to give personalised guidance. Admin staff curate the educational knowledge base, configure prompts and models, browse user conversations, and view basic analytics through a web console.

**Phase 1 success criterion:** a working prototype suitable for inviting ~50 beta users — friends, family, and early adopters. Goal is to validate that the conversational + profile + KB loop is genuinely useful and to give the team transcript access to improve content over time. Not optimised for scale.

**In scope for Phase 1**
- Bale bot, Persian-only, single assistant persona backed by tools.
- Long-lived user profile (household facts, behavioural patterns, goals/commitments).
- Hybrid profile capture: short onboarding wizard + conversational enrichment.
- Admin-curated knowledge base with images and videos as attachments.
- Hybrid retrieval (vector + keyword) over Persian content.
- Admin console: KB CRUD, prompt and model configuration, chat inspection, basic analytics.
- Dual-provider LLM access: proxy-to-frontier and Metis (`docs.metisai.ir`).
- Domains: residential electricity and gas. Water deferred.

**Out of Phase 1**
- Bill ingestion (manual or OCR), meter photo capture, IoT pairing, telemetry analytics, cashback wallet, appliance ROI calculator, mini-app, magic links, proactive nudges, SMS/email integrations, multi-channel adapters (Telegram/WhatsApp), multi-tenant admin.

---

## 1. Top-level architecture

**Two user-facing surfaces, one backend, one database.**

```
                   ┌──────────────────────────────┐
   beta users ─────┤  Bale messenger              │
                   │   (bot.bale.ai users send/   │
                   │    receive Persian messages) │
                   └──────────────┬───────────────┘
                                  │  webhook (HTTPS)
                                  ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Caddy/nginx (TLS, /bale/webhook, /admin/*, /api/*)     │
   └──────────────┬──────────────────────────────────────────┘
                  │
                  ▼
   ┌─────────────────────────────────────────────────────────┐
   │  FastAPI service (single process, multi-worker)         │
   │                                                         │
   │  Modules:                                               │
   │   bale_adapter ── parses updates, sends replies         │
   │   agent       ── provider router + agent loop + tools   │
   │   kb          ── articles, attachments, RAG retrieval   │
   │   profile     ── reads/writes, event log                │
   │   chat        ── messages, sessions, rolling summaries  │
   │   admin_api   ── REST under /api/admin/*                │
   │   admin_ui    ── static Next.js export under /admin/*   │
   │   core        ── DB models, settings, auth, logging     │
   │                                                         │
   │  Background: APScheduler (in-process)                   │
   └──────────────┬──────────────────────────────────────────┘
                  │
                  ▼
   ┌─────────────────────────────────────────────────────────┐
   │  Postgres 16 + pgvector + pg_trgm                       │
   │   app tables · KB tables · admin tables                 │
   └─────────────────────────────────────────────────────────┘

   Outbound: LLM provider router with two backends
     • Frontier (OpenAI/Anthropic) via HTTPS proxy
     • Metis (api.metisai.ir, OpenAI-compatible) direct
```

**Deployment shape:** one Docker container, one VPS (Iran-hosted), one Postgres. APScheduler runs in-process; no Redis, no message queue, no separate vector store. The bot loop and admin API share one connection pool, which is fine at Phase 1 scale.

**Module boundaries:** each module exposes a small Python API used by other modules; `bale_adapter` calls `agent.handle_message(...)` as a plain function. When/if we later split the agent into its own service (for multi-channel support), only the transport changes — the interface stays the same.

---

## 2. Data model

Postgres 16. Extensions: `pgvector`, `pg_trgm`. Hybrid schema: relational where shape is stable, `jsonb` where the shape evolves. Soft-delete via `deleted_at` where audit matters; hard-delete elsewhere.

### 2.1 Identity and profile

**`users`**
- `id` uuid PK
- `bale_user_id` bigint UNIQUE, indexed
- `display_name` text (from Bale)
- `language` text default `'fa'`
- `is_blocked` bool default false
- `created_at` timestamptz
- `last_seen_at` timestamptz
- `deleted_at` timestamptz (nullable, soft delete)

**`profiles`** (1:1 with `users`)
- `user_id` uuid PK FK → users.id
- `household` jsonb — `{ city, occupants, home_type, area_m2, heating_type, cooling_type, main_concern }`
- `behaviour` jsonb — free-form keyed facts the agent learns (e.g. `peak_usage_hours`, `comfort_temp_c`, `away_during_day`)
- `goals` jsonb — array of `{ id, text, target, deadline, status }`
- `commitments` jsonb — array of `{ id, text, made_at, target_date, fulfilled }`
- `completeness_score` int 0–100
- `updated_at` timestamptz
- `deleted_at` timestamptz (nullable)

**`profile_events`** (append-only audit/explainability log)
- `id` bigint PK
- `user_id` uuid FK
- `field_path` text — e.g. `behaviour.peak_usage_hours` or `goals[+]`
- `before` jsonb
- `after` jsonb
- `source` text — `wizard` | `agent_tool` | `admin`
- `source_message_id` bigint nullable
- `created_at` timestamptz

**`onboarding_states`**
- `user_id` uuid PK FK
- `current_step` text
- `answers` jsonb
- `started_at` timestamptz
- `completed_at` timestamptz (nullable)

### 2.2 Conversation

**`chat_sessions`**
- `id` uuid PK
- `user_id` uuid FK
- `started_at` timestamptz
- `ended_at` timestamptz (nullable; closed by 30-min idle gap)
- `last_summary_id` bigint nullable

**`messages`**
- `id` bigint PK
- `user_id` uuid FK, indexed
- `session_id` uuid FK
- `role` text — `user` | `assistant` | `tool` | `system`
- `content` text
- `tool_name` text nullable
- `tool_args` jsonb nullable
- `tool_result` jsonb nullable
- `tokens_in` int nullable
- `tokens_out` int nullable
- `latency_ms` int nullable
- `model_used` text nullable — e.g. `metis:gpt-4o-mini`
- `metadata` jsonb default `{}` — e.g. `{ flagged: true }`
- `created_at` timestamptz
- `deleted_at` timestamptz (nullable)
- Index on `(user_id, created_at DESC)` for "latest N for this user".

**`chat_summaries`**
- `id` bigint PK
- `user_id` uuid FK
- `session_id` uuid nullable (summaries can span sessions)
- `text` text — 1–2 paragraph Persian summary
- `covers_from_message_id` bigint
- `covers_to_message_id` bigint
- `created_at` timestamptz

### 2.3 Knowledge base

**`kb_articles`**
- `id` uuid PK
- `title` text
- `body` text — Markdown, Persian, canonical form (never normalised)
- `category` text CHECK in (`electricity`, `gas`, `general`)
- `tags` text[]
- `status` text — `draft` | `published`
- `published_at` timestamptz nullable
- `version` int, monotonic per article
- `created_by` uuid FK → admin_users.id
- `updated_at` timestamptz
- `deleted_at` timestamptz (nullable)

**`kb_attachments`**
- `id` uuid PK
- `article_id` uuid FK
- `type` text — `image` | `video`
- `mime_type` text
- `file_size_bytes` bigint
- `storage_path` text — `/var/lib/energybot/media/{uuid}`
- `caption_fa` text
- `order_index` int
- `bale_file_id` text nullable — cached after first send to Bale
- `duration_seconds` int nullable (video only)
- `thumbnail_path` text nullable (video only)
- `created_at` timestamptz
- `deleted_at` timestamptz nullable
- Limits: images ≤ 5 MB, videos ≤ 50 MB.

**`video_transcripts`** (1:1 with video attachments)
- `id` uuid PK
- `attachment_id` uuid UNIQUE FK
- `text` text — Persian
- `is_admin_edited` bool default false
- `created_at` timestamptz
- `updated_at` timestamptz

**`kb_chunks`** (one chunking pipeline shared by article body and video transcripts)
- `id` bigint PK
- `article_id` uuid FK
- `chunk_index` int
- `text` text — chunk text (canonical body or transcript slice)
- `text_normalized` text — same text after Persian normalisation, used for tsvector index
- `embedding` vector(1536)
- `metadata` jsonb — `{ article_title, category, tags, source: 'article' | 'video', attachment_id?: uuid, source_heading?: text }`
- `created_at` timestamptz
- Indexes:
  - HNSW on `embedding` (cosine distance)
  - GIN on `to_tsvector('simple', text_normalized)`
- Republishing an article deletes its existing chunks and inserts new ones in the same transaction.

### 2.4 Admin and configuration

**`admin_users`**
- `id` uuid PK
- `email` text UNIQUE
- `password_hash` text (argon2id)
- `role` text — `admin` | `editor`
- `is_active` bool default true
- `created_at` timestamptz
- `last_login_at` timestamptz nullable

**`admin_sessions`**
- `id` text PK (random 256-bit token, hashed at rest)
- `admin_user_id` uuid FK
- `issued_at` timestamptz
- `last_seen_at` timestamptz
- `expires_at` timestamptz

**`prompt_templates`**
- `id` uuid PK
- `key` text — e.g. `system_prompt`, `summarizer`, `wizard_extract`
- `name` text
- `body` text — Jinja2 with `{{variables}}`
- `version` int, monotonic per `key`
- `status` text — `active` | `draft` | `retired`
- `created_at` timestamptz
- `created_by` uuid FK
- `notes` text
- Invariant: at most one row per `key` has `status='active'`. Enforced by partial unique index.

**`model_configs`**
- `id` uuid PK
- `call_type` text — `chat_reasoning` | `summarize` | `embed` | `wizard_extract` | `transcribe`
- `provider` text — `frontier` | `metis`
- `model_name` text
- `params` jsonb — `{ temperature, max_tokens, top_p, fallback: { provider, model_name } }`
- `is_active` bool
- `created_at` timestamptz
- Same one-active-per-`call_type` invariant.

**`audit_log`**
- `id` bigint PK
- `admin_user_id` uuid FK
- `action` text — e.g. `kb.article.publish`, `prompt.activate`
- `entity_type` text
- `entity_id` text
- `before` jsonb
- `after` jsonb
- `created_at` timestamptz

### 2.5 Auxiliary

**`llm_calls`** (non-message LLM calls — embeddings, summaries, transcripts)
- `id` bigint PK
- `call_type` text
- `provider` text
- `model` text
- `tokens_in` int
- `tokens_out` int
- `latency_ms` int
- `status` text — `ok` | `error` | `fallback`
- `prompt_template_key` text nullable
- `prompt_template_version` int nullable
- `created_at` timestamptz

**`processed_updates`** (Bale update idempotency)
- `update_id` bigint PK
- `created_at` timestamptz
- Nightly job purges rows older than 24h.

**`daily_stats`** (precomputed dashboard rollups)
- `date` date PK
- `dau` int
- `messages` int
- `kb_hits` int
- `llm_cost_usd` numeric(10,4)
- `tokens_total` bigint
- Recomputed nightly by APScheduler job.

### 2.6 Sizing assumptions

- 50 users × ~30 messages/day → ~45 k messages/month. Trivial for Postgres.
- KB at launch: ~50–200 articles, ~5 chunks each + video transcripts → low thousands of `kb_chunks`. HNSW handles this with ease on a 2vCPU/4GB VPS.
- Local media storage: ~50 articles × (5 images @ 1 MB + 1 video @ 20 MB) → ~1–2 GB. Comfortable.
- Retention: nothing auto-purged in Phase 1 except `processed_updates` (24h). Conversation history kept indefinitely for analysis.

---

## 3. Bot interaction flows and Bale adapter

### 3.1 Bale adapter responsibilities

- `POST /bale/webhook` — verifies a shared secret in the path and/or header. Bale's update is parsed and dispatched.
- Update types handled in Phase 1: text messages, callback queries (inline-keyboard taps). Contact shares accepted but stored against the user for later phases.
- Per-user serialisation: an in-process per-user lock prevents two concurrent turns for the same user. A bounded queue (depth 2) holds the next message if a user sends faster than we reply; extras are dropped with a polite Persian "می‌بینم پیام‌هاتو، یه لحظه فرصت بده پاسخ بدم".
- Typing indicator: `sendChatAction: typing` is sent on turn start and refreshed every ~4s until the reply is dispatched.
- Outbound calls: `sendMessage` (Persian, Markdown subset Bale supports), `sendPhoto`, `sendVideo`, `editMessageReplyMarkup`, `answerCallbackQuery`.
- Retries: exponential backoff, capped at 3 attempts on 5xx / timeout. Final failures are logged with full context.
- The webhook handler always returns HTTP 200 to Bale, even when the turn failed internally (avoids Bale's indefinite-retry behaviour).

### 3.2 Onboarding wizard (first contact)

Triggered automatically on the user's first `/start` or first ever message. Five to seven structured questions, stored stepwise in `onboarding_states` so users can resume mid-flow.

| Step | Question (Persian gist) | UI |
|---|---|---|
| 1 | شهر محل سکونت | text input |
| 2 | نوع مسکن | buttons: آپارتمان / ویلایی / مجتمع |
| 3 | تعداد افراد خانوار | buttons: 1 / 2 / 3 / 4 / 5+ |
| 4 | متراژ تقریبی | range buttons |
| 5 | نوع سیستم گرمایش | buttons: پکیج / شوفاژ مرکزی / بخاری گازی / برقی |
| 6 | نوع سیستم سرمایش | buttons: کولر آبی / اسپلیت / کولر گازی پنجره‌ای / مرکزی |
| 7 | دغدغه اصلی | buttons: کاهش قبض برق / کاهش قبض گاز / یادگیری راه‌های صرفه‌جویی / سایر |

On completion the assistant sends a short Persian welcome that mirrors back what it learned and invites free conversation.

**Wizard interruptibility:** if the user starts asking real questions mid-wizard, the bot **abandons the wizard** and switches into conversational mode. Partial answers are kept in `onboarding_states`; the next time profile facts are needed and a slot is empty, the agent's `update_profile` flow asks naturally in-conversation.

### 3.3 Conversational mode (after onboarding)

Every subsequent user message goes to the agent loop (Section 4). The agent decides whether to answer from its own knowledge, search the KB, send media, update the profile, ask a clarifying question, or propose a commitment.

### 3.4 Explicit commands (kept minimal)

| Command | Behaviour |
|---|---|
| `/start` | Greeting; resume wizard if incomplete, else show a short menu |
| `/profile` | Bot sends a Persian summary of what it knows + "اصلاح" button |
| `/forget` | Soft delete; asks confirmation first. Sets `deleted_at` on `users`, `profiles`, and the user's `messages`. Admin can review/restore from "Trash" within 30 days; nightly hard-purge job removes after grace period. |
| `/help` | Short Persian help text |
| `/restart` | Closes current `chat_session`, opens a fresh one. Profile and history preserved. |

These five live in Bale's menu button for discoverability.

### 3.5 User-visible error handling

When the agent loop fails (LLM error not recoverable, tool error escaping the loop, unhandled exception):
- The user receives a polite Persian message: "متأسفم، یه مشکل فنی پیش اومد. می‌تونی یک بار دیگه تلاش کنی؟"
- A `system`-role message row is written capturing the failure cause for admin review.
- Stack traces and English errors are never shown to users.

### 3.6 Out of Phase 1 (bot side)

- Proactive nudges, reminders, weekly summaries (Phase 3).
- File upload from user (bills, meter photos) (Phase 2).
- Magic links and mini-app (Phase 2).
- Voice messages (later).

---

## 4. LLM and Agent layer

### 4.1 Provider router

Module `agent.providers`. Single abstraction with an OpenAI-compatible surface (`chat.completions.create`, `embeddings.create`). Two registered backends:

- **`frontier`** — OpenAI / Anthropic via outbound HTTPS proxy. Model namespace `openai:gpt-4o-mini`, `anthropic:claude-sonnet-4-6`, etc.
- **`metis`** — `https://api.metisai.ir/openai/v1`, Bearer-token auth, OpenAI-compatible chat/completions/embeddings/function-calling.

Every call carries a `call_type`. The router looks up the active `model_configs` row, dispatches, and on `5xx` / timeout / rate-limit it tries the configured fallback once. Each call logs to `llm_calls` (for embeddings/summaries/transcripts) or to `messages.tokens_in/out/model_used` (for chat).

**Default model assignments** (admin can override at runtime):

| call_type | default provider | default model | fallback |
|---|---|---|---|
| `chat_reasoning` | frontier | `gpt-4o-mini` (Persian quality vs cost balance; `claude-sonnet-4-6` for higher quality) | metis equivalent |
| `summarize` | metis | best Persian model on Metis | frontier `gpt-4o-mini` |
| `embed` | metis | `text-embedding-3-small` (1536) | frontier same |
| `wizard_extract` | frontier | `gpt-4o-mini` | metis |
| `transcribe` | frontier | Whisper-large | none |

Rationale for mixing providers: embeddings benefit from being inside Iran (cheap, fast, no data egress); main reasoning benefits from frontier quality. All adjustable from admin without redeploy.

### 4.2 Agent loop

Module `agent.loop`. Single entrypoint:

```python
def handle_message(user_id: UUID, text: str, ctx: TurnContext) -> str:
    ...
```

Pseudocode for the loop:

```
1. Assemble context:
     - active system prompt (prompt_templates where key='system_prompt' and is_active)
     - profile snapshot (rendered to Persian text via a Jinja2 template)
     - latest chat_summaries.text for this user (if any)
     - last ~10 messages for this user where role in ('user','assistant')
     - the new user message
2. Call provider router with call_type='chat_reasoning' and tool definitions exposed.
3. If the response contains tool calls:
     a. Execute each tool (in-process Python).
     b. Persist a row of role='tool' per call (tool_name, tool_args, tool_result).
     c. Feed results back; loop. HARD CAP: 6 tool iterations per turn.
4. If the cap is hit, force a final answer with tools disabled.
5. Persist final assistant text as role='assistant'.
6. Send to user via bale_adapter.
7. INLINE rolling-summary check: if ≥ N new messages since user's last summary (N default 20), generate a fresh summary now (via call_type='summarize'), write to chat_summaries. (Happens after reply sent, before webhook returns.)
8. Return.
```

All synchronous within the webhook request. No background "thinking".

### 4.3 Tools exposed to the agent (Phase 1)

Each tool is a small Python function with a JSON schema; the agent can invoke any combination per turn (subject to the iteration cap).

1. **`search_knowledge_base(query, category?, top_k=5)`** → list of `{ article_title, chunk_text, category, relevance, source: 'article'|'video', attachment_id? }`. Hybrid retrieval (vector + keyword, RRF). Filtered to `status='published'`.
2. **`read_profile()`** → JSON snapshot of household + behaviour + goals + commitments. Cheap; used when the agent needs more profile context than was inlined.
3. **`update_profile(path, value, source_message_id, reason)`** → writes a `profile_events` row, patches `profiles`. `path` is a JSON-path like `behaviour.peak_usage_hours` or `goals[+]`. `reason` is a short Persian explanation, stored for admin review.
4. **`record_commitment(text, target_date?)`** → appends to `commitments`. Returns the commitment id so the agent can refer back.
5. **`send_kb_media(attachment_id, caption?)`** → uses Bale `sendPhoto` or `sendVideo`. First send uploads multipart and caches `bale_file_id`; subsequent sends use the cached id.
6. **`escalate_to_human(reason)`** → flags conversation via `messages.metadata.flagged = true`. No human reply path in Phase 1; just gives the agent a graceful "I can't help" exit.

No bill, IoT, payment, or appliance tools in Phase 1.

### 4.4 Prompt template management

- All prompts live in `prompt_templates` as Jinja2 with `{{variables}}`.
- Loaded with a 60-second TTL cache per worker so admin edits propagate quickly without restart.
- Each LLM call logs `(prompt_template_key, prompt_template_version)` so prompt-change effects are correlatable in analytics.
- Activating a new version flips the `is_active` flag atomically (transaction with `UPDATE ... WHERE key = $1`) so there's never a window with zero active prompts per key.

### 4.5 Rolling-summary worker (inline)

- Runs at the end of every agent turn, after the user has received their reply but before the webhook handler returns.
- Trigger: ≥ N new messages (N default 20, configurable) since the user's `chat_summaries.covers_to_message_id`.
- Uses `call_type='summarize'` (Metis default).
- Writes one `chat_summaries` row per execution. The next turn picks up the new summary in step 1 of the agent loop.

Webhook handler stays open a bit longer on summary turns; user latency is unchanged because the reply was already sent.

### 4.6 Token / cost budget per turn (target)

- Context in: ~3–5 k tokens (system + profile + summary + ~10 messages + optional ~5 KB chunks).
- Output: ≤ 500 tokens (Persian replies tend to be concise).
- One additional embedding call when the user message triggers `search_knowledge_base`.
- Target: < ¢1 USD per user turn on frontier defaults; effectively free on Metis.

### 4.7 Failure modes

| Failure | Handling |
|---|---|
| Primary provider 5xx/timeout | Fallback provider tried once; if still failing, polite Persian error |
| Tool function throws | Error JSON returned to LLM; agent typically apologises gracefully |
| Tool iteration cap (6) hit | Forced final answer with tools disabled |
| Embedding call fails during retrieval | Tool returns empty results; agent falls back to its own knowledge with a hedge |
| KB publish embedding fails | Whole publish transaction rolled back; article remains `draft`, admin sees a Persian error |

---

## 5. Knowledge base: ingestion and retrieval

### 5.1 Article lifecycle

1. Admin creates an article in the console: title, body (Markdown, Persian), category, tags. Saved as `status='draft'`.
2. Admin uploads image and/or video attachments; video uploads kick off async transcription.
3. Admin can edit transcripts before publishing (`is_admin_edited=true` once edited).
4. Admin clicks **Publish** → backend, in one transaction:
   - Deletes old `kb_chunks` for the article.
   - Chunks the article body.
   - Chunks each video transcript.
   - Embeds all chunks in batches.
   - Inserts new `kb_chunks` rows.
   - Sets `status='published'`, `published_at = now()`, bumps `version`.
5. Edit + Republish → same atomic re-chunk + re-embed; no half-indexed window.
6. Unpublish → `status='draft'`; chunks kept, excluded from retrieval (`WHERE status='published'`).
7. Soft delete (`deleted_at`) → chunks removed, article hidden except in admin "Trash" view.

### 5.2 Chunking

- Split on Persian-aware paragraph boundaries: double newlines and Persian sentence punctuation (`.`, `؟`, `!`, `:`).
- Token-count chunks targeting **400 tokens, overlap 60 tokens**, using `tiktoken` (`cl100k_base` — close enough for Persian since both providers' tokenisers are BPE variants).
- Persist raw `text` (untouched), `text_normalized` (after Persian normalisation), `metadata` (article title, category, tags, source heading if Markdown header preserved, `source: 'article' | 'video'`, optional `attachment_id`).

### 5.3 Persian normalisation

Applied to BOTH ingest (for the `text_normalized` field) and query time. Article body itself is never mutated.

Steps:
- `ك` → `ک`
- `ي` → `ی`
- ZWNJ / half-space normalisation (consistent placement, removal of duplicates)
- Arabic-Indic digits → Persian digits
- Lowercase (no-op for Persian but harmless for any mixed Latin)
- Collapse internal whitespace

### 5.4 Embedding pipeline

- `agent.providers.embeddings.create` with `call_type='embed'`. Default: Metis `text-embedding-3-small` (1536 dims).
- Batched 64 chunks per call to amortise round-trips.
- Stored in `kb_chunks.embedding` as `vector(1536)`.
- Publish-time failure → whole transaction rolls back; admin sees a Persian error; underlying provider error logged.

### 5.5 Index

- **Vector:** HNSW on `kb_chunks.embedding` using cosine distance. Default parameters; tunable later.
- **Keyword:** GIN on `to_tsvector('simple', text_normalized)`. We use the `simple` config because Postgres ships no Persian stemmer; normalisation in 5.3 carries most of the load. If keyword quality is weak in practice we can later layer a thin Persian pre-processor or evaluate `zarrebin` / similar.

### 5.6 Retrieval (hybrid, RRF)

The `search_knowledge_base` tool, per call:

1. **Normalise** the query (5.3 steps).
2. **Vector search:** embed query (1 LLM call), fetch top-20 by cosine distance.
3. **Keyword search:** tsvector match on `text_normalized`, fetch top-20 by `ts_rank`.
4. **Merge & dedupe** by `chunk_id` using **Reciprocal Rank Fusion** (`k=60`):
   `score(chunk) = sum over query types of 1 / (k + rank_in_that_query)`
5. **Filter** to `status='published'` and matching category if provided.
6. **Trim** to `top_k` (default 5).
7. Return list of `{ article_title, chunk_text, category, relevance, source, attachment_id? }`.

One embedding call + one SQL roundtrip. Sub-200 ms typical at Phase 1 corpus size.

No external reranker, no query rewriting in Phase 1. Both are revisitable once we see real query traffic.

### 5.7 Media handling

- Storage: local filesystem `/var/lib/energybot/media/{uuid}`. Mime-type sniffed (`python-magic`), extension matched, file-size capped.
- Files served only via authenticated admin endpoints (never publicly), or sent through Bale (uploaded multipart on first send, `file_id`-cached after).
- Limits: images ≤ 5 MB, videos ≤ 50 MB.
- Video transcription: on upload, queued (APScheduler immediate executor) → `call_type='transcribe'` (Whisper via frontier proxy) → writes `video_transcripts.text`. Admin can edit. Publish gate requires transcript to exist.
- When agent calls `send_kb_media`, the tool also writes a `messages` row of `role='assistant'` with `tool_name='send_kb_media'` so the transcript view in admin shows the media reference.

### 5.8 Citation behaviour

System prompt instructs the assistant to refer to article titles naturally in Persian, not as URLs or footnotes (e.g., "همان‌طور که در راهنمای 'بهینه‌سازی مصرف پکیج' آمده..."). Articles are not user-addressable in Phase 1 (no mini-app, no public link).

---

## 6. Admin console

A Next.js SPA built as a static export, served by FastAPI at `/admin/*`. **Persian UI**. Internal use only.

### 6.1 Authentication

- Email + password (argon2id), no public signup.
- First admin created by CLI: `python -m energybot.admin create-user --email ... --role admin`.
- Subsequent admins added by existing admins through the console.
- Login → HTTP-only, `SameSite=Strict`, `Secure` session cookie tied to a server-side `admin_sessions` row. 7-day idle, 30-day absolute expiry.
- No SSO / OAuth in Phase 1.
- Two roles:
  - **`admin`** — full access.
  - **`editor`** — KB CRUD + view chats + view dashboard; cannot edit prompts/models, cannot manage admin users.
- Forgot password = another admin issues a one-time reset link (no email infra needed in Phase 1).
- Rate-limited login (5/min/IP).

### 6.2 Navigation (six top-level sections)

**1. Dashboard** — daily active users (30d), messages/day, p50/p95 turn latency, KB-hit rate, profile-completeness histogram, LLM cost/day per provider. Sourced from `daily_stats` rollup table (recomputed nightly).

**2. Users** — list with search by Bale ID, filters (`completed_onboarding`, `active_in_last_N_days`, `has_flagged_chat`). User detail page: profile snapshot, recent sessions, `profile_events` log ("see why the bot thinks X"). Buttons: `Block` (toggles `is_blocked`), `Forget` (admin-initiated soft delete).

**3. Chats** — full-text searchable transcript browser. Filters by user, date range, `flagged`, KB category touched. Session detail shows the Persian transcript with tool calls expanded inline (`search_knowledge_base` queries + results, `update_profile` calls, `send_kb_media` references).

**4. Knowledge base** — three sub-tabs:
- *Articles:* list (title, category, status, version, updated_at) → editor with Persian-aware Markdown editor, category select, tags, attachments panel (drag/drop, captions, reorder, video transcript editor). Buttons: `Save Draft`, `Preview`, `Publish`.
- *Trash:* soft-deleted articles, restore or hard-purge.
- *Search test:* "try it" pane that runs `search_knowledge_base` and shows ranked results with scores. Critical for spotting retrieval gaps.

**5. Prompts & models** — two sub-tabs (admin role only):
- *Prompt templates:* per-`key` version history → editor (Jinja2 body, variable reference, notes). Buttons: `Save as new version`, `Activate`, `Diff against active`. Activation is atomic + audit-logged.
- *Model configs:* one row per (`call_type`, `provider`); toggle which is active, edit `params`, set fallback. Same activation pattern + audit logging.

**6. Audit log** — read-only view of `audit_log` with filters by admin user, entity type, action, date range.

### 6.3 Admin API surface (`/api/admin/*`)

- All endpoints require valid session cookie + CSRF token on writes.
- Standard REST:
  - `GET /me`, `POST /login`, `POST /logout`
  - `GET /users`, `GET /users/:id`, `POST /users/:id/block`, `POST /users/:id/forget`
  - `GET /chats`, `GET /chats/:session_id`
  - `GET/POST/PUT/DELETE /kb/articles`, `POST /kb/articles/:id/publish`, `POST /kb/articles/:id/attachments`, `PATCH /kb/attachments/:id/transcript`
  - `POST /kb/search` (used by Search-test tab)
  - `GET/POST /prompts`, `POST /prompts/:id/activate`
  - `GET/POST /models`, `POST /models/:id/activate`
  - `GET /audit-log`
  - `GET /stats/dashboard`
- Every write passes through a single decorator that records `(action, entity_type, entity_id, before, after)` into `audit_log`.

### 6.4 Operational invariants enforced server-side

- `Publish` is the only path that triggers embedding. No "auto-republish on every save".
- `Activate` for prompts/models is atomic: `UPDATE prompt_templates SET status = CASE WHEN id = $1 THEN 'active' ELSE 'retired' END WHERE key = $2`.
- Static admin SPA is served behind an auth check; unauthenticated `GET /admin/*` returns the login page.

### 6.5 Out of Phase 1 (admin side)

- Multi-tenant admin.
- Granular per-feature permissions beyond admin/editor.
- Slack/email notifications.
- Bulk import/export (one-off seeding done by direct DB load script).
- Multi-factor auth (Phase 2+).

---

## 7. Operations, observability, testing, security

### 7.1 Deployment topology

- One Linux VPS (Iran-hosted; ArvanCloud or similar). 2 vCPU / 4 GB RAM sufficient for Phase 1.
- One Docker image: FastAPI + Uvicorn workers + static admin SPA bundled at `/admin/*`.
- One Postgres 16 with `pgvector` and `pg_trgm`. Co-located on the same VPS for Phase 1. Nightly logical backup (`pg_dump`) to off-box storage.
- Reverse proxy: Caddy or nginx for TLS termination (Let's Encrypt).
  - `POST /bale/webhook` — accepts only Bale IP ranges if known, otherwise enforces shared-secret in path + header.
  - `/admin/*` and `/api/admin/*` — protected by session cookie.
  - `/health` — for uptime monitor.
- Outbound HTTPS proxy URL configured per environment for the `frontier` provider; Metis calls go direct.

### 7.2 Config and secrets

Single `.env` file (or env vars):
- `DATABASE_URL`
- `BALE_BOT_TOKEN`
- `BALE_WEBHOOK_SECRET`
- `FRONTIER_PROXY_URL`, `FRONTIER_API_KEY`
- `METIS_API_KEY`, `METIS_BASE_URL`
- `SESSION_SECRET`
- `MEDIA_ROOT` (default `/var/lib/energybot/media`)

All runtime-tunable knobs (prompts, model configs, retrieval params, summary cadence, tool-iteration cap) live in DB. Restart-required changes are limited to the env vars above.

### 7.3 Background jobs (APScheduler, in-process)

- **Inline:** rolling-summary check at the end of every agent turn.
- **On demand:** video transcription job, triggered from admin upload, queued via APScheduler immediate executor.
- **Periodic:**
  - Nightly `daily_stats` recomputation.
  - Hourly `processed_updates` cleanup (rows older than 24h).
  - Nightly soft-delete grace-period hard purge (anything with `deleted_at < now() - 30d`).

### 7.4 Observability

- Structured JSON logs to stdout: one line per webhook request, LLM call, tool call, KB search, admin action. Fields: `trace_id` (per webhook request), `user_id`, `latency_ms`, `status`, `event`.
- Local rotated log files via Docker logging driver in Phase 1; pluggable later.
- `/metrics` Prometheus endpoint exposes: webhook count/latency, LLM call count/latency/tokens per provider, agent-loop iterations distribution, tool-call rate per tool, KB-hit rate, profile-completeness histogram, DB pool stats.
- A small Grafana dashboard JSON shipped with the repo (optional).
- No distributed tracing in Phase 1; in-log `trace_id` is sufficient.

### 7.5 Error handling philosophy

- User-visible errors are always polite Persian. Never expose exceptions, English errors, or stack traces.
- Webhook handler never returns 5xx to Bale (would trigger indefinite retries). It returns 200 even when the underlying turn failed; the failure is logged and an apology is sent via `sendMessage`.
- Idempotency: every Bale update has an `update_id`; we record processed ids in `processed_updates`. Duplicate webhooks are no-ops.

### 7.6 Testing strategy

- **Unit (pytest):** provider router fallback logic, agent loop tool-iteration cap, KB chunker, Persian normaliser, RRF merge function, profile-event diffing, prompt template rendering.
- **Integration (pytest + test-container Postgres):** full agent turn with mocked LLM responses, KB search round-trip (vector + keyword + RRF), publish-and-search-an-article, admin auth flow, audit log assertions, soft-delete behaviours.
- **LLM-touching smoke tests:** behind `--llm` flag, off in CI. One full agent turn against frontier and one against Metis to catch contract drift.
- **No E2E Bale tests in CI.** Manual smoke before each deploy: 5 canned conversations against a beta-test bot.
- **Evaluation harness:** `eval/run.py` replays a curated set of Persian prompts through the full agent and writes a comparison report (with vs without a prompt change). Used by admins when tuning prompts; not in CI.

### 7.7 Security

- Bale webhook secret in URL path + validated against a header. Bale-only IP allowlist if practical.
- Admin endpoints: HTTP-only `SameSite=Strict` `Secure` session cookie, CSRF token on every write, argon2id passwords, rate-limited login (5/min/IP).
- Two Postgres roles: `app` (bot path) and `admin` (admin API). Both least-privileged.
- LLM provider API keys never logged. Per-request prompts are stored in DB (for chat review) but Phase 1 collects no sensitive PII (no phone, no email, no address).
- File uploads: mime sniffed (`python-magic`), extension matched, size capped, stored under UUID filenames in a non-web-served directory.
- No content moderation pipeline in Phase 1 since user-generated content (chats) is only seen by admins via the console.

### 7.8 Data privacy

- `/forget` (user-initiated) and admin `Forget` button:
  - Set `deleted_at` on `users`, `profiles`, and the user's `messages`.
  - Redact `users.display_name`.
- Default admin views exclude soft-deleted rows; a "Trash" filter shows them within the 30-day grace period.
- Hard-purge job after 30 days irreversibly removes soft-deleted rows.
- Backups capture state-as-of; if a user demands compliance-grade erasure, backups are re-rotated separately (not expected in Phase 1).

### 7.9 Explicit non-goals in Phase 1

- No autoscaling, no load balancer, no Postgres replication.
- No multi-region.
- No SLO; "best effort, prompt rollback on failure".
- No alerting beyond an uptime monitor pinging `/health`.

---

## 8. Acceptance criteria for Phase 1

Phase 1 is considered done when **all** of the following hold:

**Bot**
- A new user starting `/start` on the bot is greeted in Persian, completes a 5–7 step onboarding wizard with inline keyboards, and can resume mid-wizard.
- Sending a real question mid-wizard abandons the wizard and switches to conversational mode; partial profile is retained.
- During free conversation the assistant can answer general energy questions, search the KB, send KB images and videos, update the profile silently via tool calls, and propose commitments.
- `/profile`, `/forget`, `/restart`, `/help` all work.
- A polite Persian apology is sent (not a stack trace) when an unrecoverable error occurs.

**Profile & memory**
- Profile facts learned via wizard and via `update_profile` tool calls show up in `/profile` and in the admin Users detail page.
- After ≥ 20 new messages, a rolling summary is generated and used in subsequent turns.
- Same Bale user across multiple sessions over multiple days sees the assistant correctly recall prior facts.

**Knowledge base**
- Admin can create, edit, attach images/videos to, transcribe, and publish a Persian article. Republishing re-embeds atomically with no half-indexed window.
- Search Test tab returns expected articles for representative Persian queries.
- The bot retrieves and cites article content naturally.

**Admin**
- A bootstrapped admin can log in, manage articles, edit/activate prompts, view chat transcripts, see dashboard numbers, view the audit log.
- Every admin write is captured in `audit_log`.

**Ops**
- One-command deploy of the Docker image to a fresh VPS works end-to-end (DB migrations, static admin built, env wiring).
- Nightly `pg_dump` is configured and shown working.
- `/health` endpoint returns 200.
- Logs are queryable; `/metrics` is reachable internally.

**Provider router**
- The system runs against either `frontier` (proxy) or `metis` configured as default, and falls back to the other on simulated 5xx.

**Privacy**
- `/forget` soft-deletes the user, redacts their display name, and removes them from default admin views.
- Hard-purge job removes them after 30 days.

When all above are demonstrated on a staging VPS with a beta-test bot account, Phase 1 ships.

---

## 9. Open items deferred to writing-plans

These were discussed but kept lightly specified; the implementation plan should treat them as small design tasks:

- Exact Persian copy for wizard, error messages, `/help`, `/profile` summary, commitment prompts. (Will be drafted during implementation and stored in a `messages.yaml` or in `prompt_templates`.)
- Final selection of Metis model names for `chat_reasoning`, `summarize`, `embed`, `transcribe` — pick concrete values after a one-day Persian-quality evaluation against current Metis catalog.
- Final pgvector HNSW build parameters (`m`, `ef_construction`) — start with defaults, tune if recall is weak on the first ~100 chunks.
- Exact Bale `sendMessage` Markdown subset — confirm during implementation; fall back to plain text where Bale rendering misbehaves.
