# User Memory — Design Spec

**Date:** 2026-06-28
**Status:** Approved for implementation
**Topic:** LLM-maintained, cross-chat user memory

## Problem

Energybot already captures *structured* facts about a user in the `Profile`
model — `household`, `behaviour`, `goals`, `commitments`. But a lot of useful
knowledge about a user is unstructured: preferences ("likes cold rooms"), life
context ("works night shifts", "has a newborn"), constraints ("landlord won't
allow AC changes"), and interaction style ("wants short answers"). None of this
fits the structured schema, yet it makes the assistant feel like it genuinely
remembers the person across chats.

We want an **LLM-maintained memory**: a store of free-form facts about the user,
written and curated by the chat agent itself, persisted across conversations,
and injected into the agent's context — holding everything that does *not* belong
in structured profile data.

## Goals

- Persist unstructured, durable knowledge about a user across chat sessions.
- Let the chat agent write and curate it directly, in the moment.
- Inject it into the agent's context so replies reflect what we remember.
- Keep it cleanly separated from structured profile data.
- Surface it read-only to the user for transparency.

## Non-goals (v1)

- User editing/deleting memory from the web app (read-only display only).
- A background distillation job (memory is maintained inline by the agent).
- A separate audit-event table for memory changes.
- Hard enforcement of the size cap (soft cap + LLM curation only).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| Maintenance mechanism | **Inline tool** (agent calls a tool mid-turn) | Consistent with `update_profile` / `record_commitment`; in-the-moment capture. |
| Storage shape | **Discrete items** (one fact per row) | Surgical add/update/remove, clean rendering, mirrors `goals`/`commitments`. |
| Persistence | **Dedicated `user_memories` table** | Memory is explicitly *separate* from structured profile; clean per-item lifecycle. |
| Categorization | **Fixed taxonomy** of 5 categories | Predictable rendering/grouping without free-form tag drift. |
| User surface (v1) | **Backend + read-only display** | Ship core value; transparency without edit complexity. |
| Growth control | **Soft cap ~40 + LLM self-curation** | Self-maintaining, no new infrastructure. |

## Architecture

### 1. Data model — `user_memories` table

New SQLAlchemy model in `src/energybot/core/models.py`, with a BigInteger
autoincrement primary key (short, stable id — same style as `Message` and
`ChatSummary`, and cheap for the agent to reference by id when updating/removing).

| column | type | notes |
|---|---|---|
| `id` | BigInteger PK, autoincrement | short stable ref shown to the agent |
| `user_id` | UUID, FK → `users.id` | indexed |
| `text` | Text | the remembered fact, in Persian |
| `category` | String | one of: `preference`, `life_context`, `constraint`, `interaction_style`, `misc` |
| `source_message_id` | BigInteger, FK → `messages.id`, nullable | which turn produced the memory |
| `created_at` | timestamp | |
| `updated_at` | timestamp | |
| `deleted_at` | timestamp, nullable | soft-delete |

- Index: `ix_user_memories_user (user_id, deleted_at)`.
- New Alembic migration in `alembic/versions/`.
- **No separate audit table.** `updated_at` + soft-delete capture the lifecycle.
  Memory is lower-stakes than structured profile data (which has `ProfileEvent`).

#### Categories

| category | meaning | example |
|---|---|---|
| `preference` | tastes / likes / dislikes | likes cold rooms; hates night notifications |
| `life_context` | situational facts about their life | works night shifts; has a newborn; rents |
| `constraint` | limits on what they can do | landlord won't allow AC changes; tight budget |
| `interaction_style` | how they want to be communicated with | wants short answers; skeptical of generic tips |
| `misc` | anything that doesn't fit above | |

### 2. Repository — `src/energybot/memory/repository.py`

`MemoryRepository` (constructed with a session, like `ProfileRepository` /
`ChatRepository`):

- `list_active(user_id) -> list[UserMemory]` — active items, ordered (e.g. by
  category then `created_at`).
- `add(user_id, text, category, source_message_id=None) -> UserMemory`
- `update(user_id, memory_id, text=None, category=None) -> UserMemory` — updates
  provided fields, bumps `updated_at`.
- `remove(user_id, memory_id) -> None` — soft-delete (sets `deleted_at`).
- `count_active(user_id) -> int`

All methods are scoped by `user_id`, so a user can never read or mutate another
user's items. `update`/`remove` on a missing/foreign/deleted `memory_id` raise a
clear error the tool can surface back to the agent.

### 3. Agent tool — `src/energybot/agent/tools/manage_memory.py`

A single `manage_memory` tool following the existing tool conventions
(`update_profile`, `record_commitment`). Parameters:

- `action`: enum — `add` | `update` | `remove`
- `text`: string — required for `add`, optional for `update`
- `category`: enum (the 5 categories) — required for `add`, optional for `update`
- `memory_id`: integer — required for `update` and `remove`

Behavior:

- The tool performs **no LLM call**. It writes to the DB inside the current
  `chat_reasoning` turn, so no new provider `call_type` / `ModelConfig` is needed.
- `add` records `source_message_id` for the current user turn when available.
- On `add`, if the user is at/over the soft cap (~40 active items), the tool
  succeeds but returns a note nudging the agent to consolidate or remove a
  stale/duplicate item.
- Validation errors (bad `memory_id`, missing required field for the action)
  return a clear message so the agent can correct itself.

The tool is registered in the agent's tool set (`src/energybot/agent/builder.py`
/ wherever tools are wired).

### 4. Context injection — `src/energybot/agent/context.py` + system prompt

- `src/energybot/memory/render.py`: `render_memory(items) -> str` produces Persian
  text grouped by category, each line prefixed with `[id]` so the agent knows what
  to `update` / `remove`. Empty memory → empty string (cleanly omitted from the
  prompt). Example:

  ```
  آنچه درباره‌ی کاربر می‌دانم:
  ترجیحات:
  - [12] اتاق خنک را دوست دارد
  شرایط زندگی:
  - [15] شیفت شب کار می‌کند
  ```

- `ContextAssembler.assemble` loads active items via `MemoryRepository`, renders
  them, and passes a new `user_memory` template variable alongside the existing
  `profile_summary` and `rolling_summary`.

- The DB `system_prompt` template (and the matching `scripts/seed_data` source)
  gains a memory section instructing the agent to:
  - treat `user_memory` as durable, cross-chat knowledge about the user;
  - use `manage_memory` to keep it current — add new facts, update changed ones,
    remove stale or duplicate ones;
  - **never** store structured profile data here (household, goals, commitments) —
    those go through `update_profile` / `record_commitment`;
  - keep the memory under ~40 items by consolidating.

### 5. Web read-only surface

- `GET /api/app/memory` in `src/energybot/user_api/` (authenticated, same JWT
  pattern as the other app endpoints). Returns the active items, grouped by
  category, in a shape suitable for display.
- A small read-only section in `app_ui` — "آنچه دستیار درباره‌ی شما به خاطر دارد" —
  folded into the existing profile page. No edit/delete in v1.

## Data flow (a chat turn that learns something)

1. User sends a message; `AgentLoop` persists it and calls `ContextAssembler`.
2. `ContextAssembler` injects current `user_memory` (plus profile + rolling
   summary) into the system prompt.
3. The LLM, seeing the conversation and existing memory, decides a new durable
   fact is worth keeping and calls `manage_memory(action="add", ...)` (or
   `update` / `remove` to curate).
4. The tool writes to `user_memories` (with `source_message_id`) and returns a
   confirmation (plus a soft-cap nudge if applicable).
5. The agent finishes its reply. On the next turn, the updated memory is already
   in context.

## Error handling

- Repository methods raise on missing/foreign/deleted `memory_id`; the tool
  catches and returns a clear message so the agent can self-correct rather than
  failing the turn.
- Memory load failures in `ContextAssembler` degrade gracefully — an empty
  `user_memory` rather than a broken turn (consistent with how missing
  summaries/profile are tolerated).
- All repository operations are `user_id`-scoped to prevent cross-user access.

## Testing

- **Repository** (`tests/`): add / update / remove (soft-delete) / list_active /
  count_active; user-scoping isolation (user A cannot touch user B's items);
  errors on invalid `memory_id`.
- **Render**: grouping by category, `[id]` prefixes, empty-memory → empty string.
- **Tool**: each `action`; required-field validation per action; invalid
  `memory_id`; soft-cap nudge near/over the limit.
- **Context**: memory text is injected into the assembled messages; empty memory
  is omitted cleanly.
- **Endpoint**: auth required; returns only active items; correct grouped shape.

## Out of scope / future work

- User-editable memory in the web app (add/edit/delete).
- Background distillation job to passively maintain memory from transcripts.
- Per-change audit-event table for memory.
- Embedding/semantic retrieval over memory (v1 injects all active items, bounded
  by the soft cap).
