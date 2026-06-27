# Bill Suggestions + Targets — Design

**Date:** 2026-06-27
**Status:** Approved (pending implementation plan)

## Goal

When a user uploads a **new** bill, generate personalized energy-saving
suggestions and measurable targets via an LLM — **exactly once per bill** — and
deliver them as a follow-up Bale message. Targets become trackable goals in the
user's profile so future bills can measure progress.

## Scope

- In scope: generation on new-bill capture, persistence, profile-goal merge,
  Persian follow-up message, re-upload behavior, prompt + model config, tests.
- Out of scope: measuring/closing targets against later bills (future work),
  surfacing suggestions on the web platform, editing/deleting generated targets.

## Decisions (from brainstorming)

| Axis | Decision |
|------|----------|
| Targets | Trackable goals merged into `Profile.goals` |
| LLM context | This bill + profile + prior bills for the same subscription |
| Delivery | Separate follow-up Bale message after the summary |
| Timing | Background task; user is not blocked |
| Re-upload (cache hit) | Re-show stored suggestions, no LLM call |
| LLM failure | Log, leave `suggestions` NULL, send nothing extra (retry on re-upload) |

## Architecture

### Trigger

In `bale_adapter/handler.py`, after `_send_capture()` sends the bill summary +
pay button for a successful capture (`res.ok and res.bill_db_id`), spawn a
background task:

```python
task = asyncio.create_task(
    generate_and_send_suggestions(user_id=user.id, chat_id=chat_id, bill_db_id=UUID(res.bill_db_id))
)
_BACKGROUND_TASKS.add(task)
task.add_done_callback(_BACKGROUND_TASKS.discard)
```

`_BACKGROUND_TASKS` is a module-level `set` so the task is not garbage-collected
before completion. The webhook/poller returns immediately; the user is not
blocked on the LLM call.

### Session lifecycle (critical)

The webhook passes a **request-scoped** session via `session_factory=lambda: session`,
which is closed when the request ends. The background task **must not** use it.
`generate_and_send_suggestions` opens its **own** session via `get_sessionmaker()`
and builds its repos/router/loader against that fresh factory.

### Generation — `billing/suggestions.py`

`generate_and_send_suggestions(user_id, chat_id, bill_db_id)`:

1. Open a fresh session factory.
2. Load the bill by id (via `BillingRepository.get_bill_by_id`).
3. **Idempotency guard:** if `bill.suggestions is not None`, render the stored
   payload and send it — **no LLM call, no re-merge**. (Covers re-upload and any
   double-trigger.)
4. Otherwise:
   - Load `Profile` (household + behaviour + existing goals).
   - Load prior bills for the **same subscription** (filter `recent_bills` /
     dedicated repo query by `subscription_id`, excluding this bill) to compute a
     previous-period delta for trend context.
   - Render prompt `bill_suggestions` with: this bill's amount, term,
     consumption breakdown (normal/peak/low/total kWh), household profile,
     behaviour, and the previous bill's amount + total consumption (or "none").
   - `router.chat(call_type="bill_suggestions", req=ChatRequest(...), prompt_key="bill_suggestions", prompt_version=...)`.
   - Parse JSON robustly (extract first balanced `{…}`; tolerate code fences).
   - On parse/LLM failure: log `bill_suggestions_failed`, leave `suggestions`
     NULL, return without sending (bill summary already delivered).
   - Persist the payload to `bill.suggestions`.
   - For each target, append a goal to `Profile.goals` via
     `ProfileRepository.append(user_id, "goals", goal_item, source="bill_suggestion", reason=...)`.
5. Render the payload via `render_suggestions` and send via `get_bale_client()`.

The task body is a plain awaitable (handler only wraps it in `create_task`), so
tests invoke it directly.

### Data model

New Alembic migration: add nullable JSONB column to `bills`.

```python
op.add_column("bills", sa.Column("suggestions", postgresql.JSONB(astext_type=sa.Text()), nullable=True))
```

`NULL` = not yet generated. Add `suggestions: Mapped[dict | None] = mapped_column(JSONB)`
to the `Bill` model.

**Stored payload shape:**

```json
{
  "generated_at": "2026-06-27T10:00:00Z",
  "intro": "مصرف برق این دوره‌ات نسبت به دوره قبل ۱۲٪ بیشتر شده ...",
  "tips": ["دمای کولر را روی ۲۵ بگذار ...", "ساعات اوج (۱۲ تا ۱۸) ..."],
  "targets": [
    {"text": "کاهش ۱۰٪ مصرف ساعات اوج تا پایان دوره بعد",
     "metric": "peak_kwh", "baseline": 120, "target_value": 108,
     "target_date": "1405/04/31"}
  ],
  "model": "deepseek-v4-flash",
  "prompt_version": 3
}
```

`metric` is a free string from a small documented set (`peak_kwh`, `total_kwh`,
`amount_rial`); `baseline`/`target_value` are numbers or null. The renderer and
goal-merge tolerate missing optional fields.

**Goal item appended to `Profile.goals`** (existing goals are free-form objects):

```json
{"id": "<uuid>", "text": "...", "status": "active", "source": "bill_suggestion",
 "bill_id": "<bill uuid>", "metric": "peak_kwh", "baseline": 120,
 "target_value": 108, "target_date": "1405/04/31"}
```

### Prompt & model config

- New seed prompt file `scripts/seed_data/prompts/bill_suggestions.md`
  (key `bill_suggestions`), Persian. Instructs the model to return **strict JSON**
  with `intro` (1–2 sentences), 2–4 `tips`, 1–3 measurable `targets`, grounded in
  the supplied bill numbers, household profile, and previous-bill delta. No prose
  outside the JSON. Jinja variables for all context fields.
- New entry in `DEFAULT_MODEL_CONFIGS` (`scripts/seed_dev.py`):
  `{"call_type": "bill_suggestions", "provider": "deepseek", "model_name": "deepseek-v4-flash", "params": {"temperature": 0.4, "fallback": {"provider": "metis", "model_name": "gpt-4o-mini"}}, "is_active": True}`.

### Delivery — `render_suggestions(payload) -> str`

Builds a Persian follow-up message:

```
💡 پیشنهادها برای این قبض
<intro>

• <tip 1>
• <tip 2>

🎯 هدف‌ها
- <target text 1>
- <target text 2>
```

Sent via the `get_bale_client()` singleton to `chat_id`. Reuses the existing
Persian-digit helpers where numbers appear.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `generate_and_send_suggestions` | Orchestrate: load, guard, generate, persist, merge, send | router, prompt loader, billing repo, profile repo, bale client |
| `render_suggestions(payload)` | Format payload → Persian message | none (pure) |
| `_parse_suggestions_json(text)` | Robustly extract/validate the LLM JSON | none (pure) |
| `_build_targets_as_goals(targets, bill_id)` | Map targets → goal items | none (pure) |
| handler change | Spawn the background task | `generate_and_send_suggestions` |
| migration + model field | `bills.suggestions` JSONB | — |
| prompt seed + model config | LLM wiring | — |

## Error handling

- LLM call error: `router` already does provider fallback; if it still fails,
  catch, log, leave `suggestions` NULL, send nothing. Re-upload retries.
- JSON parse failure: same as above.
- Send failure: log; payload is already persisted so the next re-upload re-sends.
- Profile/goal merge happens only inside the generation branch (after the NULL
  guard), so targets are never double-appended.

## Testing

- **Pure units:** `_parse_suggestions_json` (clean JSON, code-fenced, trailing
  prose, garbage → error), `render_suggestions` (Persian output, empty
  targets/tips), `_build_targets_as_goals` (field mapping, missing optionals).
- **Integration** (fake router returning canned JSON, real test DB):
  - Generates: `bill.suggestions` persisted, `Profile.goals` has the targets,
    rendered message returned/sent (fake bale client records sends).
  - Idempotency: a second call neither invokes the router nor re-appends goals;
    it re-sends the stored payload.
  - LLM failure: `suggestions` stays NULL, no goals appended, no message sent.
- **Handler:** verify a successful capture spawns the task with the right
  `bill_db_id` (the awaitable is mocked).

## Out of scope / future

- Closing/scoring targets against subsequent bills.
- Web platform surfacing of suggestions and targets.
- User-facing edit/delete of generated targets.
