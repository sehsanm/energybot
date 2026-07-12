# Onboarding Flow Redesign — Design Spec

**Date:** 2026-07-12
**Status:** Approved (design), pending implementation plan
**Scope:** Bale bot onboarding — a benefits-forward intro, a continuous resumable
onboarding sequence, a reusable multi-select widget, an intent question, a
first-bill prompt, and a "toolbox" of service preferences.

## Problem

The current onboarding is: first message → `INTRO_TEXT` self-introduction →
7-step profile wizard → home screen. It works, but:

- The intro does not sell the value proposition — that the assistant saves users
  money on electricity/gas, helps them earn rewards, and helps the country.
- We never capture *why* the user wants to reduce consumption (their motivation),
  which is useful for personalising later guidance.
- New users are not nudged to upload their first bill — the single highest-value
  action — during onboarding.
- We never ask users how they want to be served (reminders, suggestions, etc.),
  so we have no stored service preferences to act on later.

The goal is a warmer, guided first-run that introduces the value proposition,
collects the profile, learns the user's motivation, gets a first bill analysed,
and captures how the user wants to be helped — while keeping free chat available
at any time.

## What exists today (build-on, do not rebuild)

- **First-contact + wizard:** `bale_adapter/handler.py` detects a brand-new user
  (currently: *no `OnboardingState` row*) on their first message, sends
  `INTRO_TEXT`, and starts the 7-step wizard (`profile/wizard.py`,
  `WizardEngine`). Steps: city, home_type, occupants, area_m2, heating_type,
  cooling_type, main_concern. Each answer is written to the profile via
  `ProfileRepository.set(dot_path, value)` (auto-logs a `ProfileEvent`). On
  completion the handler shows the home screen (`bale_adapter/home.py`).
- **Bill upload + analysis:** `billing/service.py::BillingService.handle_input()`
  accepts image/PDF/typed number, extracts numbers (barcode / mod-11), calls the
  inquiry provider, stores a `Bill`, renders a Persian summary, and offers a
  «پرداخت 💳» button. `_spawn_suggestions()` (handler) runs async AI suggestions
  that write saving goals back to the profile
  (`ProfileRepository.replace_bill_goals`). Bills self-identify their utility
  type via barcode.
- **User memory:** `UserMemory` table + `manage_memory` agent tool; the agent
  maintains free-form durable facts, injected into context by
  `agent/context.py`.
- **Buttons:** `BaleClient.send_message(reply_markup=...)` passes a raw dict.
  Inline keyboards (`inline_keyboard`, `callback_data`), a persistent reply
  keyboard (`home.py::REPLY_KEYBOARD`, routed by exact label in
  `actions.py::REPLY_KB_ROUTES`), and a quick-action `CATALOG` with `act:<key>`
  callbacks all exist. **No multi-select pattern exists** — every keyboard is
  single-column single-tap today.
- **Persian-only, no i18n**; strings are inline literals. Onboarding/home copy is
  informal/friendly; the *agent chat persona* is formal («شما») — unchanged here.

## Goals

1. Replace `INTRO_TEXT` with a benefits-forward, friendly, emoji intro.
2. Add a **multi-select intent question** as the final profile step.
3. After the profile, prompt the user to **upload their first bill** (electricity
   or gas), then run the existing analysis pipeline.
4. Present a **toolbox** of service preferences the user multi-selects and can
   change later.
5. Make the whole sequence a **single resumable state machine**; every
   post-profile step is skippable; free chat is available at any point after the
   profile.
6. Introduce a **reusable multi-select inline widget** (used by both the intent
   step and the toolbox).

## Non-goals (YAGNI)

- **Actual reminder / scheduled-outbound delivery.** We only *persist* the
  toolbox opt-ins. Building the scheduler that sends daily reminders / periodic
  suggestions is a separate follow-up project.
- Concrete gift/reward fulfilment. Intro copy is aspirational, no specific
  promise.
- Per-service scheduling config (times, frequency, quiet hours).
- Changing the agent's formal chat persona.
- Multi-language support (Persian only).
- Hard-tagging a bill's utility type from the button (bills self-identify via
  barcode; the برق/گاز buttons are guidance only).

## Key decisions

| Decision | Choice | Rationale |
|---|---|---|
| "Onboarded?" gate | `OnboardingState.completed_at IS NOT NULL` (was: row exists) | Post-profile steps mean a row can exist mid-flow; completion must be explicit. |
| Reminders scope | Capture preference only | Keeps onboarding shippable; delivery is a distinct subsystem. |
| Reward framing | Aspirational, general | No concrete gift/reward program to promise against yet. |
| Intent storage | `behaviour.motivations` (JSONB list) | No migration; already writable + audited via `ProfileRepository.set`. |
| Service-prefs storage | New `profiles.service_prefs` JSONB column | First-class so a future scheduler can query it directly. |
| Multi-select UX | Toggle buttons + explicit «تأیید ✅» commit, via `editMessageReplyMarkup` | Native to Bale inline keyboards; no free-text; reusable. |
| Post-profile steps | All skippable, resumable per-phase | Users may not have a bill handy; must not trap them. |

## Architecture

### 1. Onboarding phase machine

`OnboardingState` gains an explicit notion of **phase**. Phases, in order:

```
profile   → the existing wizard steps, ending with the new `motivations` step
first_bill→ prompt to upload the first bill (or skip)
toolbox   → multi-select service preferences (or skip)
done      → completed_at set; home screen shown
```

Representation: reuse `OnboardingState.current_step` for the wizard sub-steps as
today, and track the coarse phase either in `current_step` (sentinel values
`__first_bill__`, `__toolbox__`) or an added `answers["_phase"]` key — the
implementation plan picks one; the behaviour is what matters.

`completed_at` is set **only when the toolbox step is committed or skipped** (or
the whole tail is skipped). Until then the user is "still onboarding."

**Handler entry becomes a resume dispatcher.** On an inbound text/callback:

- If no `OnboardingState` row → brand-new user: send intro, start wizard.
- Else if `completed_at IS NULL` → mid-onboarding: route to the current phase's
  handler (wizard answer, first-bill prompt/skip, or toolbox toggle/commit)
  rather than to the wizard unconditionally or to the agent.
- Else (`completed_at` set) → normal dispatch (commands, reply-keyboard labels,
  agent).

Optional decomposition: a thin `onboarding/flow.py` orchestrator above
`WizardEngine` owning the `first_bill` and `toolbox` phases, so `wizard.py` stays
focused on profile Q&A. The plan may keep it inside the handler + wizard if that
reads cleaner against existing patterns.

**Interruptibility (preserved + extended):** free-text that is not a wizard
answer mid-wizard still abandons into conversational mode (existing behaviour).
During `first_bill`/`toolbox`, a real question likewise drops to the agent; the
phase is retained so the next `/start` (or a nudge) can resume it. Reaching the
agent does **not** by itself set `completed_at`.

### 2. Intro copy

Rewrite `home.py::INTRO_TEXT` (Persian, informal, a few emojis). Must convey:

- who I am — an energy-saving assistant for برق و گاز;
- the upside — cut your bills, earn rewards as you save, benefits/gifts along the
  way (general, no specific promise), and help the country;
- a hand-off — "بریم پروفایلت رو بسازیم".

Kept short (Bale renders long messages poorly). No tables/heavy markdown.

### 3. Reusable multi-select widget

A new builder + callback protocol, reused by the intent step and the toolbox.

- **Render:** `inline_keyboard`, one option per row, each button text
  `☑️ <label>` when selected / `▫️ <label>` when not, plus a trailing
  «تأیید ✅» row (and, where relevant, a «رد کن» / skip row).
- **Callbacks:** `ms:<field>:<key>` toggles a key; `ms:<field>:__done__` commits;
  `ms:<field>:__skip__` skips (where allowed). `<field>` is e.g. `motivations`
  or `toolbox`.
- **State:** the in-progress selection set is held in `OnboardingState.answers`
  (e.g. `answers["motivations_draft"]`) between taps so toggles survive across
  callbacks. Toggling edits the same message via `editMessageReplyMarkup` (no
  message spam). `answer_callback_query` acknowledges each tap.
- **Commit:** on `__done__`, the selection is written to its destination
  (profile field), the draft is cleared, and the flow advances.
- **Empty selection:** committing with nothing selected is allowed (equivalent to
  skip for the toolbox; for intent, allowed but the copy nudges at least one).

Add a `BaleClient.edit_message_reply_markup(...)` wrapper if one is not already
present.

### 4. Intent step (final profile question)

A `motivations` step appended after `main_concern`, using the multi-select
widget. Options:

| key | label |
|---|---|
| `help_country` | به کشورم کمک کنم |
| `reduce_bill` | قبضم رو کم کنم |
| `earn_rewards` | جایزه و پاداش بگیرم |

On commit: `ProfileRepository.set("behaviour.motivations", [...keys])` (logged as
a `ProfileEvent`, `source="wizard"`). Then advance to `first_bill`.

The `WizardEngine` step model is extended to support a `multi` step type (a step
whose UI is the multi-select widget and whose answer is a list), distinct from
the existing single-choice/text steps.

### 5. First-bill step

Prompt (Persian): "به اولین قبضت نگاه کنیم؟ 🔎" with an inline keyboard:

| button | callback |
|---|---|
| قبض برق ⚡ | `ob:bill:elec` |
| قبض گاز 🔥 | `ob:bill:gas` |
| فعلاً نه | `ob:bill:skip` |

- `elec`/`gas` → send a short "how to send it" instruction (photo / PDF / typed
  شناسه قبض). The utility buttons are **guidance only**; the actual bill is
  parsed and typed by its barcode, not by the button.
- The next inbound photo/document/bill-number while in `first_bill` runs the
  **existing** `BillingService.handle_input` pipeline: summary + «پرداخت»
  button + async suggestions + bill-goals. This *is* the "read, analyse, build
  memory" step — suggestions write goals to the profile and the agent enriches
  `user_memory` on subsequent turns. No new analysis code.
- On a successful first bill **or** `skip`, advance to `toolbox`.
- If the user is in `first_bill` and sends something that is neither a bill nor a
  skip (e.g. a real question), drop to the agent; phase retained.

### 6. Toolbox step (service preferences)

The multi-select widget over the service catalog, with a header noting it's
changeable later: "می‌تونی هر وقت خواستی از «ابزارها» عوضش کنی."

v1 service catalog (source of truth in one place, e.g. `home.py` or a new
`onboarding/toolbox.py`):

| key | label |
|---|---|
| `daily_reminder` | یادآوری روزانه |
| `cost_suggestions` | پیشنهاد کاهش هزینه |
| `reduce_help` | راهنمایی برای کم‌کردن مصرف |
| `weekly_summary` | خلاصهٔ هفتگی قبض و مصرف |
| `peak_alert` | هشدار ساعت اوج مصرف |
| `seasonal_tips` | نکات فصلی |

On commit: write the enabled keys to `profiles.service_prefs` (JSONB list).
Then set `completed_at` and show the home screen. Committing with none selected
is allowed. A «رد کن» skip also completes onboarding (leaves `service_prefs` as
its default `[]`).

**Editable later:** a new quick action re-opens the toolbox widget prefilled with
the current `service_prefs`.

- Add a `CATALOG` entry `toolbox` → label «ابزارها».
- Add «ابزارها» to the persistent reply keyboard (`home.py::REPLY_KEYBOARD`) and
  `REPLY_KB_ROUTES`.
- Add a `/tools` command to `commands.py` + `BOT_COMMAND_MENU`.
- All three routes open the same multi-select, seeded from `service_prefs`; on
  commit they update `service_prefs` (no phase/`completed_at` involved — this is
  post-onboarding editing).

### 7. Data flow (a full first run)

```
first message
  → handler: no OnboardingState → send INTRO_TEXT; wizard.start; send step 1
  → user answers steps 1..7 (city..main_concern)     [phase=profile]
  → wizard emits the `motivations` multi-select
     → ms:motivations:* toggles (editMessageReplyMarkup)
     → ms:motivations:__done__ → set behaviour.motivations; advance
  → first_bill prompt (برق/گاز/فعلاً نه)              [phase=first_bill]
     → user taps برق → "send it" instruction
     → user sends bill → BillingService pipeline (summary+pay+suggestions+goals)
     → advance
  → toolbox multi-select                              [phase=toolbox]
     → ms:toolbox:* toggles; ms:toolbox:__done__ → write service_prefs
     → set completed_at; send home screen
  → thereafter: normal dispatch; free chat + «ابزارها» edits prefs
```

## Data model changes

- **Migration** (`alembic/versions/`): add
  `profiles.service_prefs jsonb NOT NULL DEFAULT '[]'::jsonb`.
- `behaviour.motivations` — no migration (inside existing `behaviour` JSONB).
- No new tables. `OnboardingState` phase tracking uses existing columns
  (`current_step` / `answers`).

## Error handling

- Bill inquiry/parse failure during `first_bill`: existing billing error copy;
  the user stays in `first_bill` and may retry or skip (must not be trapped).
- Multi-select on a stale/duplicate callback (e.g. double-tap `__done__`): commit
  is idempotent — if the phase already advanced, re-acknowledge and ignore.
- `editMessageReplyMarkup` failure (message too old / network): fall back to
  sending a fresh multi-select message; non-fatal.
- Unknown/invalid `ms:` or `ob:bill:` key: acknowledge and ignore (never a dead
  button), consistent with the existing `act:` filtering.
- Agent/LLM failure mid-onboarding: existing polite Persian apology; phase
  retained so the user can resume.
- Migration is additive with a default, so existing rows get `service_prefs=[]`.

## Testing

Following existing handler/wizard test patterns
(`tests/integration/test_onboarding_flow.py`, `test_wizard.py`):

- **Phase gate:** new user (no state) → intro + wizard; returning user with
  `completed_at` set → home; returning user mid-`first_bill` / mid-`toolbox`
  resumes at that step (not the wizard).
- **`completed_at` semantics:** set only at toolbox commit/skip; not set by
  reaching the agent mid-onboarding.
- **Multi-select widget:** toggle adds/removes from the draft; `editMessageReplyMarkup`
  re-render reflects `☑️/▫️`; `__done__` writes destination + clears draft;
  `__skip__` where allowed; empty-commit allowed; unknown key ignored.
- **Intent:** commit writes `behaviour.motivations` and logs a `ProfileEvent`;
  advances to `first_bill`.
- **First-bill:** برق/گاز → instruction; a bill in `first_bill` runs the billing
  pipeline and advances; `skip` advances; a non-bill question drops to the agent
  with phase retained.
- **Toolbox:** commit persists `service_prefs`; skip completes with `[]`;
  completion shows home + sets `completed_at`.
- **Later edit:** «ابزارها» / `/tools` / catalog `toolbox` opens the widget
  seeded from current `service_prefs` and updates it without touching
  `completed_at`.
- **Existing onboarding tests** updated for the new gate and the inserted
  intent/first-bill/toolbox steps.

## Affected / new files

- Modified: `src/energybot/bale_adapter/handler.py` — resume dispatcher on
  `completed_at`, `ms:` and `ob:bill:` callbacks, first-bill routing, toolbox
  commit, `/tools` + «ابزارها» routes.
- Modified: `src/energybot/profile/wizard.py` — `multi` step type + `motivations`
  step; phase progression (or a new `src/energybot/onboarding/flow.py`
  orchestrator).
- Modified: `src/energybot/bale_adapter/home.py` — new `INTRO_TEXT`, reply
  keyboard entry.
- Modified: `src/energybot/bale_adapter/actions.py` — reusable multi-select
  renderer, `toolbox` catalog entry + reply-kb route.
- New (optional): `src/energybot/onboarding/toolbox.py` — service catalog +
  toolbox builders.
- Modified: `src/energybot/bale_adapter/commands.py` — `/tools` + `BOT_COMMAND_MENU`.
- Modified: `src/energybot/bale_adapter/client.py` — `edit_message_reply_markup`
  wrapper if absent.
- Modified: `src/energybot/core/models.py` — `Profile.service_prefs`.
- New: `alembic/versions/<ts>_profile_service_prefs.py`.
- Tests mirroring the above under the existing test layout.

## Out of scope / future work

- The reminder/scheduled-outbound **delivery** system that consumes
  `service_prefs` (daily reminders, weekly summary, peak alerts, seasonal tips).
- Per-service scheduling configuration (times, frequency, quiet hours).
- Concrete gift/reward program the intro can promise against.
- Tying `service_prefs` into the agent's context so replies reflect chosen
  services.
