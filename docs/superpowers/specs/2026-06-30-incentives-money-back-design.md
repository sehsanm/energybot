# Design: Incentives & "Get Money Back" — warmer, more informative bot

**Date:** 2026-06-30
**Status:** Approved (design); ready for implementation plan
**Owner:** Sehsanm

## 1. Goal & motivation

The bot today is functional but generic: a plain greeting, a profile wizard, and on-demand saving tips. It does not tell users what we can actually do for them, and it says nothing about the real money-back programs Iranian households are eligible for.

Tavanir / the Ministry of Energy run concrete incentive programs for residential electricity:

- **طرح برق امید / free electricity** — subscribers below the regional consumption pattern (الگوی مصرف) get tiered discounts; the lowest-consumption tier (کم‌مصرف) gets up to **100% free electricity**. The middle tier (خوش‌مصرف) gets partial discounts.
- **پاداش صرفه‌جویی (savings reward)** — reduce consumption ≥10% vs. the same period last year → up to **30% of the bill back**; a per-kWh rial reward for usage under ~150 kWh/month; monthly caps that vary by climate zone (≈850k Toman normal regions, up to ≈3.3M Toman hot regions).
- **Peak-shaving & generator/load-management rewards** — cashback for cutting/shifting peak load and for generator participation.
- **Tiered tariffs** — the flip side: پُرمصرف (over-pattern) subscribers pay sharply higher rates.

**Important caveat:** these figures (thresholds, caps, percentages) change yearly and differ by climate region. Whatever we build must keep a "last verified" date and an easy update path.

This project makes the bot:

1. Warmer and clearer about what it does ("here's how to get money back / pay less").
2. Knowledgeable — the incentive programs are documented in the knowledge base.
3. Personalized & exact — a deterministic calculator uses the user's real bill + profile to compute their specific situation in Toman, not LLM-guessed numbers.

## 2. Design decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Incentive depth | KB articles **+ a deterministic calculator tool** | The system prompt forbids the LLM from doing money math from memory; a calculator makes the Toman figures exact and personalized. |
| Source of truth for numbers | **DB table + admin UI** | Consistent with the DB-backed, admin-editable KB; lets a non-developer update yearly figures without a deploy. |
| Climate-zone resolution | **Derive from a seeded, admin-editable city→zone mapping**, with an "ask the user" fallback | Profile only has free-text `city`; free-tier thresholds and reward caps differ sharply by zone. |
| Greeting/onboarding scope | **Surface incentives + refresh text** (new entry point + post-onboarding CTA), keep the 7-step wizard | The user led with "nicer greeting, be clear what we can do for them." |

## 3. Authority split (drift prevention)

- **DB params** (`incentive_param_set`) are the single source of the **exact numbers** the calculator computes from.
- **KB articles** are **prose** that explain the programs and tell the user "ask me to check your exact number." KB never carries authoritative figures the calculator also uses.

This guarantees the personalized math and the explanatory content can never silently disagree.

## 4. Components

### 4.1 Incentive data layer (DB + admin UI)

Follow the existing CRUD pattern (`ModelConfig` / `PromptTemplate` for the backend, `admin_ui/src/app/prompts/page.tsx` for the frontend).

**Table `incentive_param_set`** — rows keyed by `(effective_year, climate_zone)`:

- `id` (UUID PK)
- `effective_year` (Integer, e.g. 1404)
- `climate_zone` (String — `normal`, `hot`, `very_hot`, `cold`, … seeded set)
- `label` (String — human description)
- `params` (JSONB) — all numbers for that year/zone:
  - free-tier kWh thresholds (summer / winter)
  - discount tiers (کم‌مصرف = 100% free; خوش‌مصرف = partial %, with the boundary kWh)
  - پاداش صرفه‌جویی: `min_reduction_pct` (e.g. 10), `reward_pct_of_bill` (up to 30), `per_kwh_rial_reward` (for <150 kWh), `monthly_cap_rial`
  - peak/generator reward rates
- `is_active` (Boolean)
- `created_at`, `created_by`

**Table `city_climate_zone`** — seeded, admin-editable lookup:

- `id` (UUID PK)
- `city_name` (String, stored normalized via `normalize_fa`)
- `province` (String, nullable)
- `climate_zone` (String — must match a `climate_zone` used in `incentive_param_set`)
- `is_active` (Boolean)

**Admin screens:**

- `/admin/incentives` — list + edit param sets (form over the `params` fields; activate/deactivate).
- `/admin/incentives/cities` (or a tab) — list + edit/add city→zone rows.
- Both behind `current_admin`, CSRF-protected, writing `AuditLog` rows on mutations, exactly like `admin_api/bills.py` / `admin_api/models.py`.
- Nav entry added to `admin_ui/src/components/Sidebar.tsx`.

### 4.2 Incentive calculator (deterministic service + agent tool)

**`IncentiveCalculator` service** — pure, deterministic, fully unit-tested. **All money math happens here, never in the LLM.**

Inputs (gathered by the tool from the DB, not the model):

- The user's latest **electricity** bill: `consumption` (total kWh) + `details["consumption"]` tier breakdown (normal/peak/low/friday) + `details["amounts"]` + `term`/`details["period"]`.
- Profile household (`city`, `occupants`, and resolved `climate_zone`).
- The active `incentive_param_set` for the user's zone + season.
- The prior-year same-period bill if it exists (see new query below).

Outputs (structured dict the LLM narrates):

- **Free-tier status** — current monthly kWh vs the threshold: "you are X kWh under/over the free-electricity threshold"; if under → free/near-free; if خوش‌مصرف → how much more to cut to reach free.
- **Savings-reward estimate** — if a prior-year same-period bill exists, the **actual** reduction % and reward; otherwise a clearly-labeled **hypothetical** ("if you cut 10%, you'd get back ~Y Toman, capped at Z").
- **Marginal saving** — "cut N kWh → save ~Toman", computed from the bill's own tier amounts (cheap, high-value).
- **Eligible programs list** — برق امید, پاداش صرفه‌جویی, peak/generator, with per-program eligibility.

**Zone resolution:** normalize the profile `city` → look up `city_climate_zone` → zone. On no match, the tool returns a `need_zone` flag; the LLM asks the user a short multiple-choice and the answer is written to `profile.household.climate_zone` (used directly next time).

**Agent tool `check_incentives`** — registered in `agent/builder.py`'s `ToolRegistry` alongside `search_knowledge_base`. Returns the structured result as a `role="tool"` message. The system prompt gains a rule mirroring the KB rule: *use this tool's numbers; never compute money figures yourself.*

**New repository query** `bill_for_same_period_prior_year(subscription_id, term)` — matches the period number across years (today's only comparison is previous-bill-by-recency).

### 4.3 Knowledge base — new `incentives` category (4 articles)

Add `incentives` to the KB category enum **and** to the `search_knowledge_base` tool's `category` enum. Each article carries a "last verified: <date>" line. Articles describe programs in prose and point to the calculator for exact personal numbers:

- `incentives/01-bargh-omid-free-electricity.md` — برق امید, free tier, کم‌مصرف vs خوش‌مصرف, how to qualify.
- `incentives/02-savings-reward.md` — پاداش صرفه‌جویی (≥10% cut → up to 30% back, caps, per-kWh rule, how it's paid).
- `incentives/03-peak-and-generator-rewards.md` — peak-shaving & generator/load-management rewards, summer programs.
- `incentives/04-how-to-get-money-back-overview.md` — friendly overview that ties it together and invites the user to send a bill / ask the bot to check.
- Cross-link from the existing `electricity/01-tariff-tiers.md`.

Seeded via the existing `scripts/seed_dev.py::seed_kb` pipeline (front-matter + markdown body, chunked + embedded).

### 4.4 Greeting / menu / persona refresh

- Rewrite `home.py::INTRO_TEXT` and `HOME_TEXT` — warmer, plainly state what we do, lead with the money-back / free-electricity hook.
- Add an incentives entry point: a new button (e.g. «برق رایگان / پول پس بگیرم؟») in `home.py::REPLY_KEYBOARD` and `actions.py::CATALOG` (+ `REPLY_KB_ROUTES`), routed to a prompt/flow that triggers `check_incentives`.
- **Post-onboarding CTA:** when the wizard completes, the bot offers "می‌خوای ببینم می‌تونی برق رایگان بگیری؟ قبضت رو بفرست." (handler.py / wizard completion path).
- Update `scripts/seed_data/prompts/system_prompt.md` with an incentives/money-back behavior section: proactively surface relevant programs, call `check_incentives` for any money figure, nudge bill submission.
- Refresh the reference-only `scripts/seed_data/prompts/onboarding_welcome.md` to match the new tone (kept as admin reference per its own note).

## 5. Error handling

| Situation | Behavior |
|---|---|
| No electricity bill on file | `check_incentives` returns "need a bill"; bot asks the user to send their bill (reuses existing bill-input flow). |
| City → zone no match | Tool returns `need_zone`; bot asks a short multiple-choice; answer stored to `profile.household.climate_zone`. |
| No prior-year same-period bill | Reward shown as a clearly-labeled **hypothetical** estimate, not an actual entitlement. |
| Missing params for year/zone | Fall back to the `normal`-zone / latest-year params, flag/log it, and note the estimate may be approximate. |
| Gas bill | Not supported for reward math (m³ not parsed); bot explains gas tariff from KB prose only. |

## 6. Testing

- **Calculator unit tests:** free-tier boundary (just under / just over threshold), reward cap enforcement, <150 kWh per-kWh path, zone variance (normal vs hot caps), actual-vs-hypothetical reward, marginal-saving math.
- **Tool test:** `check_incentives` shape + `need_zone` / `need_bill` branches (pattern of `tests/integration/test_tool_search_kb.py`).
- **Repository test:** `bill_for_same_period_prior_year` matches the right period across years.
- **Admin CRUD tests:** `incentive_param_set` and `city_climate_zone` list/create/edit endpoints (auth + CSRF + audit), plus migration/schema tests.
- **Handler tests:** new incentives button routing + post-onboarding CTA.
- **KB seed test:** the 4 new articles parse and publish; `incentives` category retrievable via `search_knowledge_base`.

## 7. Scope boundaries (YAGNI)

- **No proactive scheduled nudges** (the heavier "+ proactive nudges" option) — deferred to a later project; today's surfacing is in-conversation + post-onboarding only.
- **No gas reward math** — gas m³ is not parsed today.
- **No water.**

## 8. Suggested implementation sequencing

1. **Data layer** — `incentive_param_set` + `city_climate_zone` models, migration, seed data, admin API + admin UI screens.
2. **Calculator** — `IncentiveCalculator` service + `bill_for_same_period_prior_year` query + `check_incentives` tool, registered in the agent.
3. **KB content** — the 4 `incentives` articles + category enum changes + cross-link.
4. **UX/persona** — greeting/menu/button refresh, post-onboarding CTA, system-prompt + onboarding-welcome updates.

Each step is independently testable and lands behind the previous one's data.
