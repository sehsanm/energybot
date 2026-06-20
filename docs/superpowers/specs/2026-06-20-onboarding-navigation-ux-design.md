# Onboarding & Navigation UX — Design

**Date:** 2026-06-20
**Status:** Approved (design), pending implementation plan
**Scope:** Bale bot onboarding flow, a persistent home/navigation experience, and LLM-driven contextual action buttons.

## Problem

The current bot has weak first-run and navigation UX:

- `/start` always launches the profile wizard, with no distinction between a brand-new user and a returning one.
- A brand-new user who sends a normal message (e.g. "سلام") instead of `/start` skips onboarding entirely and goes straight to chat.
- `/help` prints a flat single line of command text.
- There is no "home" surface, no buttons to help users discover functionality, and no persistent menu.
- Bale's native command menu (`setMyCommands`, the "/" list) is not registered, so no commands are discoverable from Bale's UI.
- Chat replies end with no suggested next steps, so users do not know what the bot can do for them next.

The goal is a smooth onboarding: introduce the bot and collect a profile on first contact, then drop the user onto a friendly home surface with buttons and an explicit "you can just chat" message, and offer relevant contextual action buttons at the end of chat replies.

## Goals

1. First contact (any first message or `/start`) introduces the bot, then runs the profile wizard.
2. After the profile is collected — and for returning users on `/start` — show a short intro "home" message with buttons, including an explicit note that the user can chat directly.
3. A persistent reply-keyboard menu for the core actions, always visible.
4. Register Bale's native "/" command menu.
5. End-of-chat contextual action buttons, chosen by the LLM agent from a bounded catalog so every button routes to a valid action.

## Non-Goals (YAGNI)

- Dynamic/personalized reply-keyboard contents.
- Multi-language support (Persian only, per project constraints).
- Analytics on button taps.
- Free-text LLM-authored button labels (catalog-only keeps callback routing valid).

## Architecture

### Components

#### 1. First-contact onboarding trigger (`bale_adapter/handler.py`)

A user is considered **new** when they have no `OnboardingState` row. On a new user's first inbound message — whether it is `/start` or any other text — the handler:

1. Sends a short self-introduction message.
2. Starts the existing 7-step profile wizard (`WizardEngine.start`) and sends the first step.

This closes the gap where a new user who types a greeting instead of `/start` would otherwise bypass onboarding.

Detection happens early in `handle_bale_update`, before the normal command/wizard/agent dispatch, and only for inbound text/`/start` (not for callbacks).

#### 2. Home screen (`bale_adapter/home.py`, new)

A single reusable builder produces the "home" surface. It is shown:

- When the wizard **completes** (replacing the current bare completion message).
- When a **returning** user sends `/start`.
- When the user invokes راهنما / `/help`.

The home message contains:

- A short intro of what the bot does.
- An explicit line that the user can chat directly, e.g. «همینطور می‌تونی هر سؤالی داری مستقیم برام بنویسی».
- Inline buttons for the main functionalities (drawn from the quick-action catalog).
- Installation of the **persistent reply keyboard** (same `sendMessage` call carries the `keyboard` reply markup).

Builder shape (illustrative):

```python
# home.py
def build_home_text() -> str: ...
def build_home_inline_markup() -> dict: ...      # inline_keyboard from catalog keys
def build_reply_keyboard_markup() -> dict: ...   # persistent keyboard, core 4
def build_home_message() -> tuple[str, dict]:    # text + combined reply_markup
    ...
```

Note: Bale, like Telegram, allows only one `reply_markup` per message. The home message uses the **reply keyboard** markup (to install/refresh the persistent menu). The home's "inline buttons for functionalities" are therefore delivered as part of the reply-keyboard menu rather than as a separate inline block on the same message — the core-4 reply keyboard *is* the home navigation. (Inline buttons remain the mechanism for end-of-chat contextual suggestions, where no reply keyboard is being set.)

#### 3. Persistent reply keyboard

Core 4 buttons: `قبض من · پروفایل · نسخه وب · راهنما`.

Reply-keyboard buttons send their label text back as a normal message when tapped. A small **label → action** router in the handler maps each core label to its existing command path:

| Label | Routes to |
|-------|-----------|
| قبض من | `/bill` query path |
| پروفایل | `/profile` path |
| نسخه وب | `/web` path |
| راهنما | home screen |

The router runs before normal agent dispatch so these labels are intercepted and not sent to the LLM.

#### 4. Native command menu (`bale_adapter/client.py` + startup)

Add `BaleClient.set_my_commands(commands: list[dict])`. Call it once at application startup (app lifespan in `main.py`) registering, with Persian descriptions:

- `/start` — شروع و معرفی
- `/help` — راهنما
- `/profile` — مشاهده پروفایل
- `/bill` — استعلام و پرداخت قبض
- `/web` — ورود به نسخهٔ وب
- `/restart` — شروع گفتگوی تازه

Failure to register (network/API error) is logged and non-fatal — it must not block startup.

#### 5. Quick-action catalog (`bale_adapter/actions.py`, new)

One source of truth mapping an action key to its Persian label and its router/handler:

```python
# action_key -> {label, route}
CATALOG = {
    "view_profile": {...},
    "query_bill":   {...},
    "web_login":    {...},
    "saving_tips":  {...},   # e.g. trigger a KB-backed tips prompt
    "set_goal":     {...},   # prompt the user to set/adjust a saving goal
    "more_help":    {...},   # show home screen
}
```

Used by **both** the reply-keyboard router and the inline-suggestion renderer/callback router, so every rendered button is guaranteed to correspond to a real, routable action. The catalog is the only place new quick actions are added.

#### 6. LLM-suggested inline actions (agent loop + new tool)

- **New agent tool `SuggestActions`** — argument is a list of catalog keys (a constrained enum of the catalog keys). The agent may call it once per turn with 0–3 keys it deems relevant to the conversation. Registered in `agent/builder.py` alongside the existing tools.
- **`AgentLoop`** captures the suggested keys (stored on the loop/result during the turn). `agent.handle()` returns a small result object `{text, suggestions}` instead of a bare string. (Update the single caller in `handler.py`.)
- **Handler** sends the reply text, then attaches the suggested keys as **inline buttons** with `callback_data = "act:<key>"`. Labels come from the catalog.
- **Callback handler** gains an `act:` prefix branch that looks the key up in the catalog and routes it (joining the existing `pay:` and wizard-button callback handling).
- If the agent suggests nothing, the reply carries no inline buttons (the persistent reply keyboard is still present from earlier).
- On agent error, the existing fallback message is sent; it may optionally include the `more_help` action.

#### 7. Richer `/help`

`/help` and the راهنما button both render the home screen (intro + menu) instead of the current flat text line.

### Data flow (one chat turn)

```
inbound message
  -> handler: first-contact? -> (if new) intro + start wizard; return
  -> handler: reply-keyboard label? -> route to command; return
  -> handler: command / wizard? -> existing paths
  -> handler: agent.handle(text)
       -> AgentLoop runs LLM with tools
       -> agent optionally calls SuggestActions([...keys])
       -> returns {text, suggestions}
  -> handler: send text; if suggestions, attach inline buttons (act:<key>)
  -> user taps act:query_bill
  -> callback handler: act: branch -> catalog -> bill query path
```

## Error Handling

- `set_my_commands` failure: logged, non-fatal, does not block startup.
- `SuggestActions` with invalid/unknown keys: ignored (filtered against the catalog) so a bad key never produces a dead button.
- Agent failure: existing fallback message; reply keyboard persists; optional `more_help` button.
- Reply-keyboard label collision: the label router only matches exact core-4 labels, so ordinary chat text containing those words is not intercepted (exact-match, not substring).

## Testing

Unit tests, following existing handler/wizard test patterns:

- Home builder: returns expected text (contains the "you can chat" line) and reply-keyboard markup.
- Catalog routing: label → action and `act:<key>` → action resolve correctly; unknown keys are dropped.
- First-contact detection: new user (no `OnboardingState`) on a non-`/start` message gets intro + wizard start; returning user does not.
- `/start` branching: new user → intro + wizard; returning user → home screen.
- `SuggestActions` capture: keys provided by the tool surface in `agent.handle()`'s result; invalid keys filtered.
- Callback routing: `act:` prefix dispatches through the catalog; `pay:` and wizard callbacks still work.
- Reply-keyboard label routing: core-4 labels intercepted before agent dispatch.

## Decisions / Notes

- "New user" = no `OnboardingState` row. Consequence: `/forget` (which removes user data) followed by a new message re-triggers onboarding — intended.
- `/help` shows the home screen rather than a flat text list.
- Only one `reply_markup` per message; the home message carries the persistent reply keyboard, and end-of-chat contextual suggestions are the inline-button surface.
- Catalog-only suggestions (no free-text labels) guarantee every inline button routes to a valid action.

## Affected / New Files

- New: `src/energybot/bale_adapter/home.py`
- New: `src/energybot/bale_adapter/actions.py`
- New: `src/energybot/agent/tools/suggest_actions.py` (tool)
- Modified: `src/energybot/bale_adapter/handler.py` (first-contact, label router, `act:` callbacks, agent result handling, `/help`)
- Modified: `src/energybot/bale_adapter/client.py` (`set_my_commands`)
- Modified: `src/energybot/main.py` (register commands at startup)
- Modified: `src/energybot/agent/loop.py` and `agent/builder.py` (suggestions capture + tool registration)
- Tests under the existing test layout mirroring the above.
