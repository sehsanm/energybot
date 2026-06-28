# Better Bill Suggestions — Design

**Date:** 2026-06-28
**Status:** Approved (pending implementation plan)
**Builds on:** `2026-06-27-bill-suggestions-design.md` (the original feature)

## Problem

The shipped bill-suggestions feature produces generic advice. Root causes:
- The prompt only passes amount, term, the four consumption buckets, and 7
  household fields — it omits season, days, tariff, occupant density, cost
  split, behaviour, and the previous-bill delta in usable form.
- It runs on `deepseek-v4-flash` (a small/fast model).
- The prompt never demands quantified, mechanism-specific targets, so "reduce
  10%" appears with no kWh figure and no "how".

## Goal

Make per-bill suggestions specific and quantified: feed the rich data we
already extract (as clean, code-computed numbers), run a stronger model, and
require each target to state its baseline, target, saving (kWh + toman + %),
and the mechanism that achieves it.

## Scope

- In scope: a pure context-builder, a rewritten prompt (new version), an
  enriched target schema, render + goal-mapping updates, and a model_config
  change.
- Out of scope: the AI-maintained user memory (separate follow-up spec; this
  design only leaves a guarded hook for it), gas/water-specific tariff logic,
  any DB schema/migration change.

## Decisions (from brainstorming)

| Axis | Decision |
|------|----------|
| Derived features | Computed in code; LLM receives explicit numbers |
| Model | Upgrade `bill_suggestions` → `deepseek` / `deepseek-reasoner` (metis `gpt-4o-mini` fallback kept) |
| Quantification | Full: numbers + mechanism per target |
| Sequencing | Ship this; AI-memory is a later spec, wired via a guarded `user_memory` block |

## Architecture

### 1. Context builder — `_build_suggestion_context(bill, profile, prev) -> dict`

A pure function (replaces the current `_build_prompt_variables`) returning the
Jinja variables. It reads `bill.details` (`consumption`, `amounts`, `period`,
`reading`, `tariff`/`phase`/`amper`/`customer_type`), `profile.household`,
`profile.behaviour`, and the previous bill.

Computed values:

- **`season`** + **`jalali_month`**: parse the month from `reading.current_date`
  (Jalali `"YYYY/MM/DD"`; split on `/`, take index 1). Month→season:
  - بهار (spring): 1–3 · تابستان (summer): 4–6 · پاییز (autumn): 7–9 · زمستان (winter): 10–12
  - If `current_date` is missing/unparseable → `season=None`, `jalali_month=None`.
- **`days`**: `period.days` (fallback `None`).
- **`kwh_per_day`**: `round(total/days, 1)` when both present, else `None`.
- **Shares** (% of total, rounded int): `peak_pct`, `normal_pct`, `low_pct`,
  `friday_pct` — each `None` if total is `None`/0 or the bucket is missing.
- **Density**: `kwh_per_person = round(total/occupants,1)`,
  `kwh_per_m2 = round(total/area_m2,1)` (each `None` if divisor missing/0).
- **Cost split (toman)**: `amount_toman` (period or bill.amount), plus
  `energy_toman`, `tax_toman`, `subscription_toman` from `amounts` (rial→toman
  via `//10`); each `None` if absent.
- **Buckets (kWh)**: `total_kwh`, `peak_kwh`, `normal_kwh`, `low_kwh`,
  `friday_kwh`.
- **`tariff`, `phase`, `amper`, `customer_type`** (passthrough).
- **`household`** dict (referenced via `.get`), **`behaviour`** dict.
- **`prev`**: when a prior bill exists →
  `{amount_toman, total_kwh, delta_kwh, delta_pct, delta_toman, term}`
  (deltas this − prev; `delta_pct` `None` if prev total is `None`/0); else `None`.
- **`user_memory`**: `None` for now (guarded hook for the future AI-memory
  spec — renders nothing, mirrors the `prev` pattern; not dead code).

All numeric values are plain ints/floats (no Persian-digit formatting — the
model gets raw numbers).

### 2. Prompt — `scripts/seed_data/prompts/bill_suggestions.md` (new version)

Rewritten body (seeded with `--reset-prompts`, bumping the active version):

- Presents every context field with an explicit Persian label, including
  season, days, kWh/day, the four buckets **with their % shares**, density
  (per person, per m²), the cost split, tariff/phase, behaviour, and the
  previous-bill delta.
- Instructs the model to: ground each observation in *this* bill's numbers
  (e.g. "peak is {{peak_pct}}% of total — high for {{season}}"); give 3–5
  concrete `tips`; and produce 1–3 **fully quantified** `targets`.
- Defines the enriched target object (below) and shows a JSON example.
- Handles missing fields gracefully (gas/water have no buckets → focus on
  total + amount + season); marks all savings as estimates ("حدود…").
- Guarded block: `{% if user_memory %}…{% endif %}` (empty today).
- StrictUndefined-safe: every top-level var is always present; dict access via
  `.get`; optional blocks (`prev`, `user_memory`) guarded by `{% if %}`.

### 3. Enriched target schema

Each `targets[]` item the model returns:

```json
{ "text": "کاهش ۱۰٪ مصرف اوج تابستان",
  "metric": "peak_kwh",            // peak_kwh | total_kwh | amount_toman
  "baseline": 120, "target_value": 108,
  "saving_kwh": 12, "saving_toman": 36000, "saving_pct": 10,
  "how": "انتقال مصرف کولر/لباسشویی از ساعت اوج به کم‌باری",
  "target_date": "1405/05/31" }
```

`_parse_suggestions_json` already keeps the full target dict (only requires
`text: str`), so **no parser change** — extra keys pass through and are stored.

### 4. Persistence, render, goals

- **Stored payload** (`bills.suggestions`): unchanged shape
  (`generated_at, intro, tips, targets, model, prompt_version`); `targets` now
  carry the richer fields.
- **`render_suggestions`**: for each target, render `text` plus, when present, a
  saving line (e.g. `— صرفه‌جویی حدود ۱۲ کیلووات‌ساعت (~۳۶٬۰۰۰ تومان)`) and the
  `how`. Persian-digit/toman formatting reuses the helpers in `billing/service.py`.
- **`_build_targets_as_goals`**: carry the new fields
  (`saving_kwh, saving_toman, saving_pct, how`) into each `Profile.goals` item
  alongside the existing keys. The web profile fix (`_as_text_list`) already
  flattens goals to text, so no web regression.

### 5. Model config

Update the `bill_suggestions` row in `DEFAULT_MODEL_CONFIGS`
(`scripts/seed_dev.py`) to `provider="deepseek"`,
`model_name="deepseek-reasoner"`, keeping
`params.fallback={provider: metis, model_name: gpt-4o-mini}`. Re-seed prod with
`--reset-models` to overwrite the active row (the seeder skips existing rows
unless `--reset-models`). Reasoning-model latency is acceptable in the
background task; `reasoning_content` is already handled by the router/parser.

## Components & boundaries

| Unit | Responsibility | Notes |
|------|----------------|-------|
| `_build_suggestion_context` | bill/profile/prev → prompt vars (pure) | replaces `_build_prompt_variables`; fully unit-tested |
| `_season_for_jalali_date(s)` | Jalali date string → (season, month) | pure helper |
| prompt template | present context + demand quantified targets | new version |
| `render_suggestions` | payload → Persian message incl. savings + how | updated |
| `_build_targets_as_goals` | targets → goal items incl. new fields | updated |
| model_config | point call at deepseek-reasoner | seed change |

## Error handling

Unchanged from the original feature: LLM/parse failure → log, leave
`suggestions` NULL, send nothing (retry on re-upload); atomic once-per-bill
claim still gates persist + goal-append + send. Missing detail fields degrade to
`None`/`نامشخص` rather than erroring (the context builder never raises on absent
keys).

## Testing

- **Pure units** (`_build_suggestion_context`, `_season_for_jalali_date`):
  season cutoffs for each quarter + unparseable date; share/density/delta math;
  missing-bucket (gas-style) and missing-prev cases; cost-split rial→toman.
- **`render_suggestions`**: target with full savings renders the saving + how
  line; target with null savings omits them; empty tips/targets still safe.
- **`_build_targets_as_goals`**: new fields mapped; missing optionals → None.
- **Integration** (fake router, real DB): the existing generate / idempotency /
  parse-failure tests still pass; the canned JSON gains the enriched target
  fields and the test asserts they persist into `bill.suggestions` and
  `Profile.goals`, and that the rendered message includes a saving line.
- **Prompt/config**: the seed-file test asserts the new version references the
  new fields; the model_config test asserts `bill_suggestions` →
  `deepseek-reasoner` with a fallback.

## Rollout

After merge: redeploy, then re-seed prod prompts + models with the
scripts-mount workaround and the reset flags:
`docker compose run --rm -v /srv/energybot/scripts:/app/scripts app python scripts/seed_dev.py --skip kb --reset-prompts --reset-models`
(idempotent except the explicit resets, which bump the prompt version and
overwrite the `bill_suggestions` model row).

## Future (separate spec)

AI-maintained user memory: a fact store the assistant grows from chat, surfaced
to suggestions through the `user_memory` block left here.
